const express = require('express');
const { body, param, validationResult } = require('express-validator');
const Cargo = require('../models/Cargo');
const { authenticateToken, requireAdmin, requireGestor } = require('../middleware/auth');
const AuditLog = require('../services/auditLog');

const router = express.Router();

// GET /api/cargos
router.get('/', authenticateToken, (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const cargos = Cargo.getAll(includeInactive);
    res.json(cargos);
  } catch (err) {
    console.error('List cargos error:', err);
    res.status(500).json({ error: 'Erro ao listar cargos' });
  }
});

// GET /api/cargos/:id
router.get('/:id', authenticateToken, [
  param('id').isInt().withMessage('ID inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const cargo = Cargo.findById(req.params.id);
    if (!cargo) return res.status(404).json({ error: 'Cargo não encontrado' });
    res.json(cargo);
  } catch (err) {
    console.error('Get cargo error:', err);
    res.status(500).json({ error: 'Erro ao buscar cargo' });
  }
});

// POST /api/cargos
router.post('/', authenticateToken, requireGestor, [
  body('nome').notEmpty().trim().withMessage('Nome do cargo obrigatório')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const id = Cargo.create(req.body);
    AuditLog.log(req.user.id, 'create', 'cargo', id, { nome: req.body.nome }, req.ip);
    res.status(201).json({ id, message: 'Cargo criado com sucesso' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Já existe um cargo com este nome' });
    }
    console.error('Create cargo error:', err);
    res.status(500).json({ error: 'Erro ao criar cargo' });
  }
});

// PUT /api/cargos/:id
router.put('/:id', authenticateToken, requireGestor, [
  param('id').isInt().withMessage('ID inválido'),
  body('nome').optional().notEmpty().trim().withMessage('Nome não pode ser vazio')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const cargo = Cargo.findById(req.params.id);
    if (!cargo) return res.status(404).json({ error: 'Cargo não encontrado' });
    Cargo.update(req.params.id, req.body);
    AuditLog.log(req.user.id, 'update', 'cargo', parseInt(req.params.id), req.body, req.ip);
    res.json({ message: 'Cargo atualizado com sucesso' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Já existe um cargo com este nome' });
    }
    console.error('Update cargo error:', err);
    res.status(500).json({ error: 'Erro ao atualizar cargo' });
  }
});

// DELETE /api/cargos/:id (soft delete)
router.delete('/:id', authenticateToken, requireAdmin, [
  param('id').isInt().withMessage('ID inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const cargo = Cargo.findById(req.params.id);
    if (!cargo) return res.status(404).json({ error: 'Cargo não encontrado' });
    Cargo.delete(req.params.id);
    AuditLog.log(req.user.id, 'delete', 'cargo', parseInt(req.params.id), { nome: cargo.nome }, req.ip);
    res.json({ message: 'Cargo desativado com sucesso' });
  } catch (err) {
    console.error('Delete cargo error:', err);
    res.status(500).json({ error: 'Erro ao desativar cargo' });
  }
});

module.exports = router;
