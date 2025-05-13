const express = require('express');
const router = express.Router();
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const AuditLog = require('../models/AuditLog');
const { authMiddleware, roleMiddleware } = require('../middleware/authMiddleware');

router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      console.log('Missing required fields:', { name, email, password });
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }
    if (role && !['Admin', 'Manager', 'User'].includes(role)) {
      console.log('Invalid role provided:', role);
      return res.status(400).json({ message: 'Invalid role. Must be Admin, Manager, or User' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    console.log(`Register attempt for: ${normalizedEmail}, role: ${role || 'User'}`);

    let user = await User.findOne({ email: normalizedEmail });
    if (user) {
      console.log(`User already exists: ${normalizedEmail}`);
      return res.status(400).json({ message: 'User already exists' });
    }

    // Restrict Admin role to authenticated Admins
    if (role === 'Admin') {
      return authMiddleware(req, res, () => {
        roleMiddleware(['Admin'])(req, res, async () => {
          await createUser(req, res, { name, email: normalizedEmail, password, role });
        });
      });
    }

    // Allow Manager or User roles without authentication
    await createUser(req, res, { name, email: normalizedEmail, password, role: role || 'User' });
  } catch (err) {
    console.error('Registration error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Helper function to create user
async function createUser(req, res, { name, email, password, role }) {
  try {
    const user = new User({
      name,
      email,
      password, // Plain-text, hashed by pre('save')
      role
    });

    await user.save();
    console.log(`User saved: ${email}, role: ${role}`);

    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });

    await new AuditLog({
      userId: user._id,
      action: 'REGISTER',
      resource: 'USER',
      resourceId: user._id,
      details: `User ${email} registered as ${role}`
    }).save();

    return res.status(201).json({ token, message: 'User registered successfully' });
  } catch (err) {
    console.error('User creation error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
}

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      console.log('Missing email or password:', { email, password });
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    console.log(`Login attempt for: ${normalizedEmail}`);

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      console.log(`User not found: ${normalizedEmail}`);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    console.log(`Stored hash for ${normalizedEmail}: ${user.password}`);
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      console.log(`Password mismatch for: ${normalizedEmail}`);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });

    await new AuditLog({
      userId: user._id,
      action: 'LOGIN',
      resource: 'USER',
      resourceId: user._id,
      details: `User ${normalizedEmail} logged in`
    }).save();

    return res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
    return res.json(user);
  } catch (err) {
    console.error('Auth/me error:', err.message);
    return res.status(401).json({ message: 'Invalid token' });
  }
});

module.exports = router;