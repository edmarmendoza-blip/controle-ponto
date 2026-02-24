const express = require('express');
const jwt = require('jsonwebtoken');
const { body, param, query, validationResult } = require('express-validator');
const User = require('../models/User');
const { loginLimiter } = require('../middleware/rateLimiter');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const AuditLog = require('../services/auditLog');
const EmailService = require('../services/emailService');
const { db } = require('../config/database');

const router = express.Router();

function logAccess(userId, nome, email, acao, ip, userAgent) {
  try {
    db.prepare('INSERT INTO access_log (user_id, user_nome, user_email, acao, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)').run(
      userId || null, nome || null, email || null, acao, ip || null, userAgent || null
    );
  } catch (err) {
    console.error('[AccessLog] Error:', err.message);
  }
}

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
      logAccess(null, null, email, 'login_failed', req.ip, req.get('User-Agent'));
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const valid = await User.validatePassword(password, user.password);
    if (!valid) {
      logAccess(user.id, user.name, email, 'login_failed', req.ip, req.get('User-Agent'));
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
    logAccess(user.id, user.name, user.email, 'login', req.ip, req.get('User-Agent'));

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
    db.prepare("UPDATE users SET password = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(hashedPassword, req.user.id);

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

    // Send welcome email with credentials
    const roleLabels = { admin: 'Administrador', gestor: 'Gestor', viewer: 'Visualizador' };
    EmailService.send({
      to: req.body.email,
      subject: '[Lar Digital] Sua conta foi criada',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1e40af; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0;">Bem-vindo(a) ao Lar Digital!</h2>
          </div>
          <div style="padding: 20px; background: #f8fafc; border-radius: 0 0 8px 8px;">
            <p>Olá <strong>${req.body.name}</strong>,</p>
            <p>Sua conta no sistema <strong>Lar Digital</strong> foi criada com sucesso.</p>
            <div style="background: white; border: 2px solid #1e40af; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <table style="width: 100%;">
                <tr><td style="padding: 6px 0; color: #64748b;">E-mail:</td><td style="padding: 6px 0; font-weight: bold;">${req.body.email}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Senha:</td><td style="padding: 6px 0; font-weight: bold; font-size: 18px; letter-spacing: 1px;">${req.body.password}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b;">Função:</td><td style="padding: 6px 0;">${roleLabels[req.body.role] || req.body.role}</td></tr>
              </table>
            </div>
            <p><a href="${process.env.APP_URL || 'https://lardigital.app'}/login.html" style="display: inline-block; background: #1e40af; color: white; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">Acessar o Sistema</a></p>
            <p style="color: #dc2626; font-size: 14px;"><strong>Importante:</strong> Troque sua senha após o primeiro login.</p>
            <hr style="border: none; border-top: 1px solid #e2e8f0;">
            <p style="color: #94a3b8; font-size: 12px;">Lar Digital - Gestão da Casa</p>
          </div>
        </div>
      `
    }).catch(err => {
      console.error('[Email] Welcome user email error:', err.message);
    });

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
    if (req.body.telefone !== undefined) updateData.telefone = req.body.telefone;
    if (req.body.pode_criar_tarefas !== undefined) updateData.pode_criar_tarefas = parseInt(req.body.pode_criar_tarefas) ? 1 : 0;
    if (req.body.pode_criar_tarefas_whatsapp !== undefined) updateData.pode_criar_tarefas_whatsapp = parseInt(req.body.pode_criar_tarefas_whatsapp) ? 1 : 0;

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

// POST /api/auth/users/:id/reset-password - Generate new password and send by email
router.post('/users/:id/reset-password', authenticateToken, requireAdmin, [
  param('id').isInt().withMessage('ID inválido')
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

    // Generate random password
    const crypto = require('crypto');
    const newPassword = crypto.randomBytes(4).toString('hex'); // 8 char hex password

    const bcrypt = require('bcryptjs');
    const { db } = require('../config/database');
    const hashed = await bcrypt.hash(newPassword, 12);
    db.prepare("UPDATE users SET password = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(hashed, user.id);

    // Send email
    const sent = await EmailService.send({
      to: user.email,
      subject: '[Lar Digital] Sua senha foi redefinida',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1e40af; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0;">Senha Redefinida</h2>
          </div>
          <div style="padding: 20px; background: #f8fafc; border-radius: 0 0 8px 8px;">
            <p>Olá <strong>${user.name}</strong>,</p>
            <p>Sua senha no sistema Lar Digital foi redefinida por um administrador.</p>
            <div style="background: white; border: 2px solid #1e40af; border-radius: 8px; padding: 16px; text-align: center; margin: 20px 0;">
              <p style="color: #64748b; margin: 0 0 8px 0; font-size: 14px;">Sua nova senha:</p>
              <p style="font-size: 24px; font-weight: bold; color: #1e40af; margin: 0; letter-spacing: 2px;">${newPassword}</p>
            </div>
            <p style="color: #dc2626; font-size: 14px;"><strong>Importante:</strong> Troque sua senha após o primeiro login.</p>
            <p style="color: #64748b; font-size: 14px;">Acesse: <a href="${process.env.APP_URL || 'https://lardigital.app'}" style="color: #1e40af;">${process.env.APP_URL || 'https://lardigital.app'}</a></p>
            <hr style="border: none; border-top: 1px solid #e2e8f0;">
            <p style="color: #94a3b8; font-size: 12px;">Lar Digital - Gestão da Casa</p>
          </div>
        </div>
      `
    });

    AuditLog.log(req.user.id, 'password_reset', 'user', parseInt(req.params.id), { email: user.email }, req.ip);

    res.json({
      message: sent ? 'Senha redefinida e enviada por e-mail' : 'Senha redefinida (e-mail não configurado)',
      emailSent: !!sent
    });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Erro ao redefinir senha' });
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

// POST /api/auth/forgot-password - Self-service password recovery
router.post('/forgot-password', loginLimiter, [
  body('email').isEmail().normalizeEmail().withMessage('Email inválido')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const user = User.findByEmail(req.body.email);
    // Always return success to prevent email enumeration
    if (!user || !user.active) {
      return res.json({ message: 'Se o e-mail estiver cadastrado, você receberá um código de recuperação.' });
    }
    const crypto = require('crypto');
    const { db } = require('../config/database');
    // Generate 6-digit code
    const code = String(crypto.randomInt(100000, 999999));
    // Store code with 30-minute expiry
    db.prepare("UPDATE users SET reset_code = ?, reset_code_expires = datetime('now','localtime','+30 minutes'), updated_at = datetime('now','localtime') WHERE id = ?").run(code, user.id);
    await EmailService.send({
      to: user.email,
      subject: '[Lar Digital] Código de Recuperação de Senha',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1e40af; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0;">Recuperação de Senha</h2>
          </div>
          <div style="padding: 20px; background: #f8fafc; border-radius: 0 0 8px 8px;">
            <p>Olá <strong>${user.name}</strong>,</p>
            <p>Seu código de recuperação de senha:</p>
            <div style="background: white; border: 2px solid #1e40af; border-radius: 8px; padding: 16px; text-align: center; margin: 20px 0;">
              <p style="font-size: 32px; font-weight: bold; color: #1e40af; margin: 0; letter-spacing: 6px;">${code}</p>
            </div>
            <p style="color: #dc2626; font-size: 14px;"><strong>Importante:</strong> Este código expira em 30 minutos.</p>
            <hr style="border: none; border-top: 1px solid #e2e8f0;">
            <p style="color: #94a3b8; font-size: 12px;">Lar Digital - Gestão da Casa</p>
          </div>
        </div>
      `
    }).catch(err => console.error('[Email] Forgot password error:', err.message));
    AuditLog.log(user.id, 'password_reset_request', 'user', user.id, { self_service: true }, req.ip);
    res.json({ message: 'Se o e-mail estiver cadastrado, você receberá um código de recuperação.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Erro ao processar solicitação' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', loginLimiter, [
  body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
  body('code').notEmpty().withMessage('Código obrigatório'),
  body('newPassword').isLength({ min: 6 }).withMessage('Nova senha deve ter pelo menos 6 caracteres')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { email, code, newPassword } = req.body;
    const { db } = require('../config/database');
    const bcrypt = require('bcryptjs');

    const user = db.prepare("SELECT * FROM users WHERE email = ? AND active = 1").get(email);
    if (!user) {
      return res.status(400).json({ error: 'Código inválido ou expirado' });
    }
    if (!user.reset_code || user.reset_code !== code) {
      return res.status(400).json({ error: 'Código inválido ou expirado' });
    }
    // Check expiry
    const now = new Date();
    const expires = new Date(user.reset_code_expires);
    if (now > expires) {
      db.prepare("UPDATE users SET reset_code = NULL, reset_code_expires = NULL WHERE id = ?").run(user.id);
      return res.status(400).json({ error: 'Código expirado. Solicite um novo.' });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    db.prepare("UPDATE users SET password = ?, reset_code = NULL, reset_code_expires = NULL, updated_at = datetime('now','localtime') WHERE id = ?").run(hashed, user.id);
    AuditLog.log(user.id, 'password_reset', 'user', user.id, { self_service: true }, req.ip);
    res.json({ message: 'Senha alterada com sucesso! Faça login com a nova senha.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Erro ao redefinir senha' });
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

// POST /api/auth/logout
router.post('/logout', authenticateToken, (req, res) => {
  try {
    logAccess(req.user.id, req.user.name, req.user.email, 'logout', req.ip, req.get('User-Agent'));
  } catch (err) {
    console.error('[AccessLog] Logout error:', err.message);
  }
  res.json({ message: 'Logout registrado' });
});

// GET /api/auth/access-log (admin)
router.get('/access-log', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { page, userId, acao, startDate, endDate } = req.query;
    const limit = 50;
    const pageNum = parseInt(page) || 1;
    const offset = (pageNum - 1) * limit;

    let where = 'WHERE 1=1';
    const params = [];

    if (userId) { where += ' AND user_id = ?'; params.push(parseInt(userId)); }
    if (acao) { where += ' AND acao = ?'; params.push(acao); }
    if (startDate) { where += " AND date(created_at) >= ?"; params.push(startDate); }
    if (endDate) { where += " AND date(created_at) <= ?"; params.push(endDate); }

    const total = db.prepare(`SELECT COUNT(*) as total FROM access_log ${where}`).get(...params).total;
    const logs = db.prepare(`SELECT * FROM access_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

    res.json({ logs, total, page: pageNum, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('Access log error:', err);
    res.status(500).json({ error: 'Erro ao buscar log de acessos' });
  }
});

module.exports = router;
