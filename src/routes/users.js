const express = require('express');
const { body, param, validationResult } = require('express-validator');
const User = require('../models/User');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const AuditLog = require('../services/auditLog');

const router = express.Router();

// GET /api/users
router.get('/', authenticateToken, requireAdmin, (req, res) => {
  try {
    const users = User.getAll();
    res.json(users);
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

// POST /api/users
router.post('/', authenticateToken, requireAdmin, [
  body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
  body('name').notEmpty().trim().withMessage('Nome obrigatório'),
  body('password').isLength({ min: 6 }).withMessage('Senha deve ter pelo menos 6 caracteres'),
  body('role').isIn(['admin', 'gestor', 'viewer']).withMessage('Role inválido')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const existing = User.findByEmail(req.body.email);
    if (existing) return res.status(400).json({ error: 'Email já cadastrado' });

    const id = await User.create(req.body);
    AuditLog.log(req.user.id, 'create', 'user', id, { email: req.body.email, role: req.body.role }, req.ip);
    res.status(201).json({ id, message: 'Usuário criado com sucesso' });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

// PUT /api/users/:id
router.put('/:id', authenticateToken, requireAdmin, [
  param('id').isInt().withMessage('ID inválido')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const user = User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    const updateData = {};
    if (req.body.name) updateData.name = req.body.name;
    if (req.body.email) updateData.email = req.body.email;
    if (req.body.role) updateData.role = req.body.role;
    if (req.body.active !== undefined) updateData.active = req.body.active;

    User.update(req.params.id, updateData);

    if (req.body.password) {
      const bcrypt = require('bcryptjs');
      const { db } = require('../config/database');
      const hashed = await bcrypt.hash(req.body.password, 12);
      db.prepare("UPDATE users SET password = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(hashed, parseInt(req.params.id));
    }
    AuditLog.log(req.user.id, 'update', 'user', parseInt(req.params.id), { email: user.email }, req.ip);
    res.json({ message: 'Usuário atualizado com sucesso' });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

// DELETE /api/users/:id
router.delete('/:id', authenticateToken, requireAdmin, [
  param('id').isInt().withMessage('ID inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const userId = parseInt(req.params.id);
    if (userId === req.user.id) return res.status(400).json({ error: 'Você não pode excluir seu próprio usuário' });

    const user = User.findById(userId);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    User.update(userId, { active: 0 });
    AuditLog.log(req.user.id, 'delete', 'user', userId, { email: user.email }, req.ip);
    res.json({ message: 'Usuário desativado com sucesso' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Erro ao desativar usuário' });
  }
});

module.exports = router;
