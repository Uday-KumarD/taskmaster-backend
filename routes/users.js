const express = require('express');
const router = express.Router();
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { authMiddleware, roleMiddleware } = require('../middleware/authMiddleware');

router.use(authMiddleware);

router.get('/', roleMiddleware(['Admin', 'Manager']), async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    console.error('User fetch error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id/promote', roleMiddleware(['Admin']), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.role === 'Admin') return res.status(400).json({ message: 'Cannot modify Admin role' });
    if (user.role === 'Manager') return res.status(400).json({ message: 'User is already a Manager' });
    user.role = 'Manager';
    await user.save();
    await new AuditLog({
      userId: req.user._id,
      action: 'PROMOTE',
      resource: 'USER',
      resourceId: user._id,
      details: `User ${user.name} promoted to Manager`,
    }).save();
    res.json({ message: 'User promoted to Manager' });
  } catch (err) {
    console.error('User promote error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;