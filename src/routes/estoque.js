const express = require('express');
const { param, validationResult } = require('express-validator');
const Estoque = require('../models/Estoque');
const { authenticateToken, requireGestor } = require('../middleware/auth');
const AuditLog = require('../services/auditLog');

const router = express.Router();

// GET /api/estoque - list all items
router.get('/', authenticateToken, (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const items = Estoque.getAllItems(includeInactive);
    res.json({ success: true, data: items });
  } catch (error) {
    console.error('[Estoque] List error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao listar itens' });
  }
});

// GET /api/estoque/alertas - items with low stock
router.get('/alertas', authenticateToken, (req, res) => {
  try {
    const alertas = Estoque.getAlertasEstoqueBaixo();
    res.json({ success: true, data: alertas });
  } catch (error) {
    console.error('[Estoque] Alertas error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao buscar alertas' });
  }
});

// GET /api/estoque/categorias
router.get('/categorias', authenticateToken, (req, res) => {
  try {
    const categorias = Estoque.getCategorias();
    res.json({ success: true, data: categorias });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Erro ao buscar categorias' });
  }
});

// GET /api/estoque/movimentacoes - all recent movements
router.get('/movimentacoes', authenticateToken, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const movs = Estoque.getAllMovimentacoes(limit);
    res.json({ success: true, data: movs });
  } catch (error) {
    console.error('[Estoque] Movimentacoes error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao listar movimentações' });
  }
});

// GET /api/estoque/:id - item detail
router.get('/:id', authenticateToken, [param('id').isInt().withMessage('ID inválido')], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
    const item = Estoque.findItemById(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Item não encontrado' });
    item.movimentacoes = Estoque.getMovimentacoes(item.id);
    res.json({ success: true, data: item });
  } catch (error) {
    console.error('[Estoque] Get error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao buscar item' });
  }
});

// POST /api/estoque - create item
router.post('/', authenticateToken, requireGestor, (req, res) => {
  try {
    const { nome, categoria, unidade, quantidade_atual, quantidade_minima, localizacao } = req.body;
    if (!nome) return res.status(400).json({ success: false, error: 'Nome é obrigatório' });
    const id = Estoque.createItem({ nome, categoria, unidade, quantidade_atual, quantidade_minima, localizacao });
    AuditLog.log(req.user.id, 'create', 'estoque', id, { nome }, req.ip);
    res.json({ success: true, id });
  } catch (error) {
    console.error('[Estoque] Create error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao criar item' });
  }
});

// PUT /api/estoque/:id - update item
router.put('/:id', authenticateToken, requireGestor, [param('id').isInt().withMessage('ID inválido')], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
    Estoque.updateItem(req.params.id, req.body);
    AuditLog.log(req.user.id, 'update', 'estoque', parseInt(req.params.id), req.body, req.ip);
    res.json({ success: true });
  } catch (error) {
    console.error('[Estoque] Update error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao atualizar item' });
  }
});

// DELETE /api/estoque/:id - soft delete
router.delete('/:id', authenticateToken, requireGestor, [param('id').isInt().withMessage('ID inválido')], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
    Estoque.deleteItem(req.params.id);
    AuditLog.log(req.user.id, 'delete', 'estoque', parseInt(req.params.id), {}, req.ip);
    res.json({ success: true });
  } catch (error) {
    console.error('[Estoque] Delete error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao excluir item' });
  }
});

// POST /api/estoque/:id/movimentacao - register movement
router.post('/:id/movimentacao', authenticateToken, requireGestor, [param('id').isInt().withMessage('ID inválido')], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
    const { tipo, quantidade, observacao } = req.body;
    if (!tipo || !quantidade) return res.status(400).json({ success: false, error: 'Tipo e quantidade são obrigatórios' });
    if (!['entrada', 'saida', 'ajuste', 'compra'].includes(tipo)) {
      return res.status(400).json({ success: false, error: 'Tipo inválido' });
    }
    const item = Estoque.findItemById(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Item não encontrado' });

    const movId = Estoque.registrarMovimentacao({
      item_id: parseInt(req.params.id),
      tipo,
      quantidade: parseFloat(quantidade),
      observacao,
      registrado_por: req.user.id,
      fonte: 'manual'
    });
    AuditLog.log(req.user.id, 'movimentacao', 'estoque', parseInt(req.params.id), { tipo, quantidade }, req.ip);
    const updated = Estoque.findItemById(req.params.id);
    res.json({ success: true, id: movId, quantidade_atual: updated.quantidade_atual });
  } catch (error) {
    console.error('[Estoque] Movimentacao error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao registrar movimentação' });
  }
});

module.exports = router;
