const express = require('express');
const jwt = require('jsonwebtoken');
const { body, param, query, validationResult } = require('express-validator');
const User = require('../models/User');
const { loginLimiter } = require('../middleware/rateLimiter');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const AuditLog = require('../services/auditLog');

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

    // Check 2FA if enabled
    if (user.totp_enabled) {
      const { totpToken } = req.body;
      if (!totpToken) {
        return res.status(200).json({ requires2FA: true, message: 'Token 2FA necessário' });
      }
      const speakeasy = require('speakeasy');
      const totpValid = speakeasy.totp.verify({
        secret: user.totp_secret,
        encoding: 'base32',
        token: totpToken,
        window: 1
      });
      if (!totpValid) {
        return res.status(401).json({ error: 'Token 2FA inválido' });
      }
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRATION || '24h' }
    );

    AuditLog.log(user.id, 'login', 'user', user.id, null, req.ip);

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

    AuditLog.log(req.user.id, 'password_change', 'user', req.user.id, null, req.ip);

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
  body('role').isIn(['admin', 'gestor', 'viewer']).withMessage('Role inválido')
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
    AuditLog.log(req.user.id, 'create', 'user', id, { email: req.body.email, name: req.body.name, role: req.body.role }, req.ip);
    res.status(201).json({ id, message: 'Usuário criado com sucesso' });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// PUT /api/auth/users/:id (admin)
router.put('/users/:id', authenticateToken, requireAdmin, [
  param('id').isInt().withMessage('ID inválido'),
  body('name').optional().notEmpty().trim().withMessage('Nome não pode ser vazio'),
  body('email').optional().isEmail().normalizeEmail().withMessage('Email inválido'),
  body('role').optional().isIn(['admin', 'gestor', 'viewer']).withMessage('Role inválido'),
  body('active').optional().isInt({ min: 0, max: 1 }).withMessage('Active inválido'),
  body('password').optional().isLength({ min: 6 }).withMessage('Senha deve ter no mínimo 6 caracteres')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const user = User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const updateData = {};
    if (req.body.name) updateData.name = req.body.name;
    if (req.body.email) updateData.email = req.body.email;
    if (req.body.role) updateData.role = req.body.role;
    if (req.body.active !== undefined) updateData.active = parseInt(req.body.active);

    if (req.body.password) {
      const bcrypt = require('bcryptjs');
      const { db } = require('../config/database');
      const hashedPassword = await bcrypt.hash(req.body.password, 12);
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.params.id);
    }

    if (Object.keys(updateData).length > 0) {
      User.update(req.params.id, updateData);
    }

    AuditLog.log(req.user.id, 'update', 'user', parseInt(req.params.id), updateData, req.ip);
    res.json({ message: 'Usuário atualizado com sucesso' });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// DELETE /api/auth/users/:id (admin)
router.delete('/users/:id', authenticateToken, requireAdmin, [
  param('id').isInt().withMessage('ID inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'Não é possível desativar sua própria conta' });
    }

    const user = User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    User.delete(req.params.id);
    AuditLog.log(req.user.id, 'delete', 'user', parseInt(req.params.id), { email: user.email, name: user.name }, req.ip);
    res.json({ message: 'Usuário desativado com sucesso' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/auth/2fa/setup - Generate TOTP secret and QR code
router.post('/2fa/setup', authenticateToken, async (req, res) => {
  try {
    const speakeasy = require('speakeasy');
    const QRCode = require('qrcode');

    const secret = speakeasy.generateSecret({
      name: `LarDigital:${req.user.email}`,
      issuer: 'Lar Digital'
    });

    // Store secret temporarily (not enabled yet until verified)
    const { db } = require('../config/database');
    db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret.base32, req.user.id);

    const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);

    res.json({
      secret: secret.base32,
      qrCode: qrDataUrl
    });
  } catch (err) {
    console.error('2FA setup error:', err);
    res.status(500).json({ error: 'Erro ao configurar 2FA' });
  }
});

// POST /api/auth/2fa/verify - Verify TOTP token and enable 2FA
router.post('/2fa/verify', authenticateToken, [
  body('token').notEmpty().withMessage('Token TOTP obrigatório')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const speakeasy = require('speakeasy');
    const { db } = require('../config/database');

    const user = db.prepare('SELECT totp_secret FROM users WHERE id = ?').get(req.user.id);
    if (!user || !user.totp_secret) {
      return res.status(400).json({ error: 'Execute o setup do 2FA primeiro' });
    }

    const verified = speakeasy.totp.verify({
      secret: user.totp_secret,
      encoding: 'base32',
      token: req.body.token,
      window: 1
    });

    if (!verified) {
      return res.status(400).json({ error: 'Token inválido' });
    }

    db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(req.user.id);
    AuditLog.log(req.user.id, '2fa_enabled', 'user', req.user.id, null, req.ip);

    res.json({ message: '2FA ativado com sucesso' });
  } catch (err) {
    console.error('2FA verify error:', err);
    res.status(500).json({ error: 'Erro ao verificar 2FA' });
  }
});

// DELETE /api/auth/2fa - Disable 2FA
router.delete('/2fa', authenticateToken, (req, res) => {
  try {
    const { db } = require('../config/database');
    db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(req.user.id);
    AuditLog.log(req.user.id, '2fa_disabled', 'user', req.user.id, null, req.ip);
    res.json({ message: '2FA desativado com sucesso' });
  } catch (err) {
    console.error('2FA disable error:', err);
    res.status(500).json({ error: 'Erro ao desativar 2FA' });
  }
});

// GET /api/auth/2fa/status - Check if 2FA is enabled for current user
router.get('/2fa/status', authenticateToken, (req, res) => {
  try {
    const { db } = require('../config/database');
    const user = db.prepare('SELECT totp_enabled FROM users WHERE id = ?').get(req.user.id);
    res.json({ enabled: !!(user && user.totp_enabled) });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao verificar status 2FA' });
  }
});

// GET /api/auth/audit-log (admin)
router.get('/audit-log', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { page, userId, action, entityType, startDate, endDate } = req.query;
    const result = AuditLog.getAll({
      page: parseInt(page) || 1,
      userId: userId ? parseInt(userId) : undefined,
      action: action || undefined,
      entityType: entityType || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined
    });
    res.json(result);
  } catch (err) {
    console.error('Audit log error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
