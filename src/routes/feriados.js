const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const Feriado = require('../models/Feriado');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

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
    const id = Feriado.create(req.body);
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
    res.json({ message: 'Feriado excluído com sucesso' });
  } catch (err) {
    console.error('Delete feriado error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
