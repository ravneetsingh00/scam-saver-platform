const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const environmentAdminIdentity = require('../utils/environmentAdmin');

const adminPasswordLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg });
  next();
};
const safeUser = account => ({ id: account._id, name: account.name, email: account.email, role: account.role, createdAt: account.createdAt, avatar: account.avatar || '' });
const makeToken = account => jwt.sign({ id: account._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

router.post('/register', [
  body('name').trim().isLength({ min: 2, max: 80 }).withMessage('Name must be 2 to 80 characters.'),
  body('email').isEmail().normalizeEmail().withMessage('Enter a valid email.'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
], validate, asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  if (await User.exists({ email })) return res.status(409).json({ message: 'An account with this email already exists.' });
  const account = await User.create({ name, email, password: await bcrypt.hash(password, 12) });
  res.status(201).json({ token: makeToken(account), user: safeUser(account) });
}));

router.post('/login', [body('email').isEmail().normalizeEmail(), body('password').isString().notEmpty()], validate, asyncHandler(async (req, res) => {
  const account = await User.findOne({ email: req.body.email }).select('+password');
  if (!account || !await bcrypt.compare(req.body.password, account.password)) return res.status(401).json({ message: 'Email or password is incorrect.' });
  res.set('Cache-Control', 'no-store').json({ token: makeToken(account), user: safeUser(account) });
}));

// Password-only admin access is checked against ADMIN_PASSWORD and remains rate-limited.
router.post('/admin-login', adminPasswordLimit, [body('password').isString().isLength({ min: 8, max: 200 })], validate, asyncHandler(async (req, res) => {
  const configuredPassword = process.env.ADMIN_PASSWORD;
  if (!configuredPassword) return res.status(503).json({ message: 'Admin access is not configured. Set ADMIN_PASSWORD in the project root .env file.' });
  // Compare fixed-length digests so this environment-backed login does not need a MongoDB account.
  const suppliedDigest = crypto.createHash('sha256').update(req.body.password, 'utf8').digest();
  const configuredDigest = crypto.createHash('sha256').update(configuredPassword, 'utf8').digest();
  if (!crypto.timingSafeEqual(suppliedDigest, configuredDigest)) return res.status(401).json({ message: 'Admin password is incorrect.' });
  const user = environmentAdminIdentity();
  const token = jwt.sign({ sub: user._id, role: 'admin', authMode: 'environment-admin' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
  res.set('Cache-Control', 'no-store').json({ token, user: safeUser(user) });
}));

router.get('/me', protect, (req, res) => res.set('Cache-Control', 'private, no-store').json({ user: safeUser(req.user) }));
router.patch('/me', protect, [
  body('name').trim().isLength({ min: 2, max: 80 }).withMessage('Name must be 2 to 80 characters.'),
  body('email').isEmail().normalizeEmail().withMessage('Enter a valid email.'),
  body('avatar').optional({ nullable: true }).isString().isLength({ max: 70000 }).withMessage('Profile image is too large.'),
], validate, asyncHandler(async (req, res) => {
  const { name, email } = req.body;
  if (await User.exists({ email, _id: { $ne: req.user._id } })) return res.status(409).json({ message: 'An account with this email already exists.' });
  if (req.body.avatar && !/^data:image\/(?:jpeg|png|webp);base64,/.test(req.body.avatar)) return res.status(400).json({ message: 'Choose a JPG, PNG or WebP profile image.' });
  req.user.name = name; req.user.email = email;
  if (Object.prototype.hasOwnProperty.call(req.body, 'avatar')) req.user.avatar = req.body.avatar || '';
  await req.user.save();
  res.set('Cache-Control', 'private, no-store').json({ user: safeUser(req.user) });
}));
router.patch('/me/password', protect, asyncHandler(async (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  if (newPassword.length < 8 || newPassword.length > 200) return res.status(400).json({ message: 'New password must be at least 8 characters.' });
  const account = await User.findById(req.user._id).select('+password');
  if (!account || !await bcrypt.compare(currentPassword, account.password)) return res.status(400).json({ message: 'Current password is incorrect.' });
  account.password = await bcrypt.hash(newPassword, 12);
  await account.save();
  res.set('Cache-Control', 'private, no-store').json({ message: 'Password updated successfully.' });
}));
module.exports = router;
