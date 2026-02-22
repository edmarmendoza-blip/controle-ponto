const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { loginLimiter } = require('../middleware/rateLimiter');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', loginLimiter, [
  body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
  body('password').notEmpty().withMessage('Senha obrigatória')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;
    const user = User.findByEmail(email);

    if (!user || !user.active) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const valid = await User.validatePassword(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRATION || '24h' }
    );

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// PUT /api/auth/password
router.put('/password', authenticateToken, [
  body('currentPassword').notEmpty().withMessage('Senha atual obrigatória'),
  body('newPassword').isLength({ min: 6 }).withMessage('Nova senha deve ter no mínimo 6 caracteres')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const user = User.findByEmail(req.user.email);
    const valid = await User.validatePassword(req.body.currentPassword, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Senha atual incorreta' });
    }

    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(req.body.newPassword, 12);
    const { db } = require('../config/database');
    db.prepare('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hashedPassword, req.user.id);

    res.json({ message: 'Senha alterada com sucesso' });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/auth/users (admin)
router.get('/users', authenticateToken, requireAdmin, (req, res) => {
  const users = User.getAll();
  res.json(users);
});

// POST /api/auth/users (admin)
router.post('/users', authenticateToken, requireAdmin, [
  body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
  body('password').isLength({ min: 6 }).withMessage('Senha deve ter no mínimo 6 caracteres'),
  body('name').notEmpty().trim().withMessage('Nome obrigatório'),
  body('role').isIn(['admin', 'viewer']).withMessage('Role inválido')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const existing = User.findByEmail(req.body.email);
    if (existing) {
      return res.status(409).json({ error: 'Email já cadastrado' });
    }

    const id = await User.create(req.body);
    res.status(201).json({ id, message: 'Usuário criado com sucesso' });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
