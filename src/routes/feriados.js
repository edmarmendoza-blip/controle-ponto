const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const Feriado = require('../models/Feriado');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const AuditLog = require('../services/auditLog');
const GoogleCalendarService = require('../services/googleCalendar');

const router = express.Router();

// POST /api/feriados/sync (admin) - MUST be before /:id
router.post('/sync', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const year = req.body.year || new Date().getFullYear();
    const result = await GoogleCalendarService.syncHolidays(year);
    AuditLog.log(req.user.id, 'sync', 'feriado', null, { year, ...result }, req.ip);
    res.json({
      message: `Sincronização concluída: ${result.added} adicionados, ${result.updated} atualizados`,
      ...result
    });
  } catch (err) {
    console.error('Sync holidays error:', err);
    res.status(500).json({ error: 'Erro ao sincronizar feriados' });
  }
});

// GET /api/feriados/sync-status
router.get('/sync-status', authenticateToken, (req, res) => {
  const lastSync = GoogleCalendarService.getLastSync();
  res.json({ lastSync });
});

// GET /api/feriados
router.get('/', authenticateToken, (req, res) => {
  try {
    const ano = req.query.ano ? parseInt(req.query.ano) : null;
    const feriados = Feriado.getAll(ano);
    res.json(feriados);
  } catch (err) {
    console.error('List feriados error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/feriados/:id
router.get('/:id', authenticateToken, [
  param('id').isInt().withMessage('ID inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const feriado = Feriado.findById(req.params.id);
    if (!feriado) {
      return res.status(404).json({ error: 'Feriado não encontrado' });
    }
    res.json(feriado);
  } catch (err) {
    console.error('Get feriado error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/feriados
router.post('/', authenticateToken, requireAdmin, [
  body('data').isDate().withMessage('Data inválida'),
  body('descricao').notEmpty().trim().withMessage('Descrição obrigatória'),
  body('tipo').isIn(['nacional', 'estadual', 'municipal', 'facultativo']).withMessage('Tipo inválido'),
  body('ano').isInt({ min: 2020, max: 2099 }).withMessage('Ano inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const id = Feriado.create({ ...req.body, manual: 1 });
    AuditLog.log(req.user.id, 'create', 'feriado', id, { data: req.body.data, descricao: req.body.descricao }, req.ip);
    res.status(201).json({ id, message: 'Feriado criado com sucesso' });
  } catch (err) {
    console.error('Create feriado error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// PUT /api/feriados/:id
router.put('/:id', authenticateToken, requireAdmin, [
  param('id').isInt().withMessage('ID inválido'),
  body('data').optional().isDate().withMessage('Data inválida'),
  body('descricao').optional().notEmpty().trim().withMessage('Descrição não pode ser vazia'),
  body('tipo').optional().isIn(['nacional', 'estadual', 'municipal', 'facultativo']).withMessage('Tipo inválido'),
  body('ano').optional().isInt({ min: 2020, max: 2099 }).withMessage('Ano inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const feriado = Feriado.findById(req.params.id);
    if (!feriado) {
      return res.status(404).json({ error: 'Feriado não encontrado' });
    }
    Feriado.update(req.params.id, req.body);
    AuditLog.log(req.user.id, 'update', 'feriado', parseInt(req.params.id), req.body, req.ip);
    res.json({ message: 'Feriado atualizado com sucesso' });
  } catch (err) {
    console.error('Update feriado error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// DELETE /api/feriados/:id
router.delete('/:id', authenticateToken, requireAdmin, [
  param('id').isInt().withMessage('ID inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const feriado = Feriado.findById(req.params.id);
    if (!feriado) {
      return res.status(404).json({ error: 'Feriado não encontrado' });
    }
    Feriado.delete(req.params.id);
    AuditLog.log(req.user.id, 'delete', 'feriado', parseInt(req.params.id), { descricao: feriado.descricao }, req.ip);
    res.json({ message: 'Feriado excluído com sucesso' });
  } catch (err) {
    console.error('Delete feriado error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
