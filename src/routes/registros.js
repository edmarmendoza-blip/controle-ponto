const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const Registro = require('../models/Registro');
const Funcionario = require('../models/Funcionario');
const HorasExtrasService = require('../services/horasExtras');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const AuditLog = require('../services/auditLog');

const router = express.Router();

// GET /api/registros/hoje
router.get('/hoje', authenticateToken, (req, res) => {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const registros = Registro.getByDate(hoje);
    res.json(registros);
  } catch (err) {
    console.error('Get registros hoje error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/registros/dashboard
router.get('/dashboard', authenticateToken, (req, res) => {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const summary = Registro.getDashboardSummary(hoje);
    res.json(summary);
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/registros
router.get('/', authenticateToken, [
  query('data').optional().isDate().withMessage('Data inválida'),
  query('dataInicio').optional().isDate().withMessage('Data início inválida'),
  query('dataFim').optional().isDate().withMessage('Data fim inválida'),
  query('funcionarioId').optional().isInt().withMessage('ID funcionário inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { data, dataInicio, dataFim, funcionarioId } = req.query;

    let registros;
    if (data) {
      registros = Registro.getByDate(data, funcionarioId || null);
    } else if (dataInicio && dataFim) {
      registros = Registro.getByPeriod(dataInicio, dataFim, funcionarioId || null);
    } else {
      const hoje = new Date().toISOString().split('T')[0];
      registros = Registro.getByDate(hoje, funcionarioId || null);
    }

    res.json(registros);
  } catch (err) {
    console.error('Get registros error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/registros/:id
router.get('/:id', authenticateToken, [
  param('id').isInt().withMessage('ID inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const registro = Registro.findById(req.params.id);
    if (!registro) {
      return res.status(404).json({ error: 'Registro não encontrado' });
    }
    res.json(registro);
  } catch (err) {
    console.error('Get registro error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/registros
router.post('/', authenticateToken, [
  body('funcionario_id').isInt().withMessage('Funcionário obrigatório'),
  body('data').isDate().withMessage('Data inválida'),
  body('entrada').optional({ nullable: true }).matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Hora de entrada inválida (HH:MM)'),
  body('saida').optional({ nullable: true }).matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Hora de saída inválida (HH:MM)'),
  body('observacao').optional().trim(),
  body('latitude').optional({ nullable: true }).isFloat({ min: -90, max: 90 }).withMessage('Latitude inválida'),
  body('longitude').optional({ nullable: true }).isFloat({ min: -180, max: 180 }).withMessage('Longitude inválida')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const funcionario = Funcionario.findById(req.body.funcionario_id);
    if (!funcionario) {
      return res.status(404).json({ error: 'Funcionário não encontrado' });
    }

    const id = Registro.create({
      ...req.body,
      created_by: req.user.id
    });
    AuditLog.log(req.user.id, 'create', 'registro', id, { funcionario_id: req.body.funcionario_id, data: req.body.data }, req.ip);
    res.status(201).json({ id, message: 'Registro criado com sucesso' });
  } catch (err) {
    if (err.message.includes('Já existe')) {
      return res.status(409).json({ error: err.message });
    }
    console.error('Create registro error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// PUT /api/registros/:id
router.put('/:id', authenticateToken, [
  param('id').isInt().withMessage('ID inválido'),
  body('entrada').optional({ nullable: true }).matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Hora de entrada inválida (HH:MM)'),
  body('saida').optional({ nullable: true }).matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Hora de saída inválida (HH:MM)'),
  body('observacao').optional().trim(),
  body('latitude').optional({ nullable: true }).isFloat({ min: -90, max: 90 }).withMessage('Latitude inválida'),
  body('longitude').optional({ nullable: true }).isFloat({ min: -180, max: 180 }).withMessage('Longitude inválida')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const registro = Registro.findById(req.params.id);
    if (!registro) {
      return res.status(404).json({ error: 'Registro não encontrado' });
    }

    Registro.update(req.params.id, req.body, req.user.id);
    AuditLog.log(req.user.id, 'update', 'registro', parseInt(req.params.id), req.body, req.ip);
    res.json({ message: 'Registro atualizado com sucesso' });
  } catch (err) {
    console.error('Update registro error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// DELETE /api/registros/:id
router.delete('/:id', authenticateToken, requireAdmin, [
  param('id').isInt().withMessage('ID inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const registro = Registro.findById(req.params.id);
    if (!registro) {
      return res.status(404).json({ error: 'Registro não encontrado' });
    }

    Registro.delete(req.params.id);
    AuditLog.log(req.user.id, 'delete', 'registro', parseInt(req.params.id), null, req.ip);
    res.json({ message: 'Registro excluído com sucesso' });
  } catch (err) {
    console.error('Delete registro error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
