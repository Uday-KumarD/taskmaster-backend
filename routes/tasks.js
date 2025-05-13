const express = require('express');
const router = express.Router();
const Task = require('../models/Task');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { authMiddleware, roleMiddleware } = require('../middleware/authMiddleware');

router.use(authMiddleware);

router.post('/', roleMiddleware(['Admin', 'Manager']), async (req, res) => {
  try {
    const { title, description, dueDate, priority, assignee } = req.body;
    if (!title || !dueDate) {
      return res.status(400).json({ message: 'Title and due date are required' });
    }
    const parsedDueDate = new Date(dueDate);
    if (isNaN(parsedDueDate)) {
      return res.status(400).json({ message: 'Invalid due date format' });
    }
    if (assignee && !(await User.findById(assignee))) {
      return res.status(400).json({ message: 'Assignee not found' });
    }
    if (assignee && assignee === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot assign task to yourself' });
    }
    const task = new Task({
      title,
      description,
      dueDate: parsedDueDate,
      priority: priority || 'Medium',
      creator: req.user._id,
      assignee,
      status: 'To Do'
    });
    await task.save();
    console.log(`Task created: ${title} by user ${req.user.email}`);
    await new AuditLog({
      userId: req.user._id,
      action: 'CREATE',
      resource: 'TASK',
      resourceId: task._id,
      details: `Task ${title} created`
    }).save();
    if (assignee) {
      req.io.to(assignee.toString()).emit('taskAssigned', {
        taskId: task._id,
        title,
        assignedBy: req.user.name
      });
    }
    res.status(201).json(task);
  } catch (err) {
    console.error('Task creation error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/', async (req, res) => {
  try {
    const { search, status, priority, dueDate } = req.query;
    const query = {};
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (dueDate) query.dueDate = { $lte: new Date(dueDate) };
    if (req.user.role === 'User') {
      query.$or = [{ assignee: req.user._id }, { creator: req.user._id }];
    } else if (req.user.role === 'Manager') {
      query.$or = [{ creator: req.user._id }, { assignee: req.user._id }];
    }
    const tasks = await Task.find(query).populate('creator assignee').sort({ dueDate: 1 });
    console.log(`Fetched ${tasks.length} tasks for user ${req.user.email}`);
    res.json(tasks);
  } catch (err) {
    console.error('Task fetch error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const task = await Task.findById(req.params.id).populate('creator assignee');
    if (!task) return res.status(404).json({ message: 'Task not found' });
    if (req.user.role === 'User' && task.creator.toString() !== req.user._id.toString() && task.assignee?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }
    if (req.user.role === 'Manager' && task.creator.toString() !== req.user._id.toString() && task.assignee?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }
    console.log(`Fetched task ${task.title} for user ${req.user.email}`);
    res.json(task);
  } catch (err) {
    console.error('Task get error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { title, description, dueDate, priority, status, assignee } = req.body;
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });
    if (req.user.role === 'User' && task.assignee?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }
    if (req.user.role === 'Manager' && task.creator.toString() !== req.user._id.toString() && task.assignee?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }
    if (assignee && !(await User.findById(assignee))) {
      return res.status(400).json({ message: 'Assignee not found' });
    }
    if (assignee && assignee === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot assign task to yourself' });
    }
    const parsedDueDate = dueDate ? new Date(dueDate) : task.dueDate;
    if (dueDate && isNaN(parsedDueDate)) {
      return res.status(400).json({ message: 'Invalid due date format' });
    }
    task.title = title || task.title;
    task.description = description || task.description;
    task.dueDate = parsedDueDate;
    task.priority = priority || task.priority;
    task.status = status || task.status;
    task.assignee = assignee || task.assignee;
    await task.save();
    console.log(`Updated task ${task.title} by user ${req.user.email}`);
    await new AuditLog({
      userId: req.user._id,
      action: 'UPDATE',
      resource: 'TASK',
      resourceId: task._id,
      details: `Task ${task.title} updated`
    }).save();
    if (assignee && task.assignee?.toString() !== assignee) {
      req.io.to(assignee.toString()).emit('taskAssigned', {
        taskId: task._id,
        title: task.title,
        assignedBy: req.user.name
      });
    }
    res.json(task);
  } catch (err) {
    console.error('Task update error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/:id', roleMiddleware(['Admin', 'Manager']), async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });
    if (req.user.role === 'Manager' && task.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }
    const assigneeId = task.assignee?.toString();
    await task.deleteOne();
    console.log(`Deleted task ${task.title} by user ${req.user.email}`);
    await new AuditLog({
      userId: req.user._id,
      action: 'DELETE',
      resource: 'TASK',
      resourceId: task._id,
      details: `Task ${task.title} deleted`
    }).save();
    if (assigneeId) {
      req.io.to(assigneeId).emit('taskDeleted', { taskId: task._id });
    }
    res.json({ message: 'Task deleted' });
  } catch (err) {
    console.error('Task delete error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;