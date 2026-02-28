const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { param, validationResult } = require('express-validator');
const { authenticateToken, requireGestor } = require('../middleware/auth');
const AuditLog = require('../services/auditLog');
const Despesa = require('../models/Despesa');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../public/uploads/comprovantes');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `comprovante-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// GET /api/despesas - list despesas with filters
router.get('/', authenticateToken, (req, res) => {
  try {
    const { status, funcionario_id, categoria, data_inicio, data_fim, page, limit } = req.query;
    const result = Despesa.getAll({ status, funcionario_id, categoria, data_inicio, data_fim, page, limit });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[Despesas] List error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao listar despesas' });
  }
});

// GET /api/despesas/relatorio - get report data
router.get('/relatorio', authenticateToken, (req, res) => {
  try {
    const { mes, ano } = req.query;
    const relatorio = Despesa.getRelatorio(mes, ano);
    res.json({ success: true, data: relatorio });
  } catch (error) {
    console.error('[Despesas] Relatorio error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao gerar relatório' });
  }
});

// GET /api/despesas/:id - get despesa detail
router.get('/:id', authenticateToken, [param('id').isInt().withMessage('ID inválido')], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const despesa = Despesa.findById(req.params.id);
    if (!despesa) return res.status(404).json({ success: false, error: 'Despesa não encontrada' });

    res.json({ success: true, data: despesa });
  } catch (error) {
    console.error('[Despesas] Get error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao buscar despesa' });
  }
});

// POST /api/despesas - create despesa manually
router.post('/', authenticateToken, requireGestor, upload.single('comprovante'), (req, res) => {
  try {
    const { funcionario_id, descricao, valor, categoria, estabelecimento, data_despesa, observacao } = req.body;

    if (!descricao) return res.status(400).json({ success: false, error: 'Descrição é obrigatória' });
    if (!valor || isNaN(parseFloat(valor))) return res.status(400).json({ success: false, error: 'Valor é obrigatório e deve ser numérico' });

    const comprovante_path = req.file
      ? `/uploads/comprovantes/${req.file.filename}`
      : null;

    const id = Despesa.create({
      funcionario_id: funcionario_id || null,
      descricao,
      valor: parseFloat(valor),
      categoria: categoria || 'outros',
      estabelecimento: estabelecimento || null,
      data_despesa: data_despesa || null,
      comprovante_path,
      fonte: 'manual',
      observacao: observacao || null
    });

    AuditLog.log(req.user.id, 'create', 'despesa', id, { descricao, valor }, req.ip);
    res.json({ success: true, id });
  } catch (error) {
    console.error('[Despesas] Create error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao criar despesa' });
  }
});

// PUT /api/despesas/:id - update despesa
router.put('/:id', authenticateToken, requireGestor, [param('id').isInt().withMessage('ID inválido')], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const despesa = Despesa.findById(req.params.id);
    if (!despesa) return res.status(404).json({ success: false, error: 'Despesa não encontrada' });

    Despesa.update(req.params.id, req.body);
    AuditLog.log(req.user.id, 'update', 'despesa', parseInt(req.params.id), req.body, req.ip);
    res.json({ success: true });
  } catch (error) {
    console.error('[Despesas] Update error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao atualizar despesa' });
  }
});

// POST /api/despesas/:id/aprovar - approve despesa
router.post('/:id/aprovar', authenticateToken, requireGestor, [param('id').isInt().withMessage('ID inválido')], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const despesa = Despesa.findById(req.params.id);
    if (!despesa) return res.status(404).json({ success: false, error: 'Despesa não encontrada' });
    if (despesa.status !== 'pendente') {
      return res.status(400).json({ success: false, error: 'Apenas despesas pendentes podem ser aprovadas' });
    }

    Despesa.approve(req.params.id, req.user.id);
    AuditLog.log(req.user.id, 'aprovar_despesa', 'despesa', parseInt(req.params.id), {}, req.ip);
    res.json({ success: true });
  } catch (error) {
    console.error('[Despesas] Aprovar error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao aprovar despesa' });
  }
});

// POST /api/despesas/:id/rejeitar - reject despesa
router.post('/:id/rejeitar', authenticateToken, requireGestor, [param('id').isInt().withMessage('ID inválido')], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const despesa = Despesa.findById(req.params.id);
    if (!despesa) return res.status(404).json({ success: false, error: 'Despesa não encontrada' });
    if (despesa.status !== 'pendente') {
      return res.status(400).json({ success: false, error: 'Apenas despesas pendentes podem ser rejeitadas' });
    }

    const { observacao } = req.body;
    Despesa.reject(req.params.id, req.user.id, observacao);
    AuditLog.log(req.user.id, 'rejeitar_despesa', 'despesa', parseInt(req.params.id), { observacao }, req.ip);
    res.json({ success: true });
  } catch (error) {
    console.error('[Despesas] Rejeitar error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao rejeitar despesa' });
  }
});

// POST /api/despesas/:id/reembolsar - mark as reimbursed
router.post('/:id/reembolsar', authenticateToken, requireGestor, [param('id').isInt().withMessage('ID inválido')], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const despesa = Despesa.findById(req.params.id);
    if (!despesa) return res.status(404).json({ success: false, error: 'Despesa não encontrada' });
    if (despesa.status !== 'aprovado') {
      return res.status(400).json({ success: false, error: 'Apenas despesas aprovadas podem ser marcadas como reembolsadas' });
    }

    Despesa.markReimbursed(req.params.id);
    AuditLog.log(req.user.id, 'reembolsar_despesa', 'despesa', parseInt(req.params.id), {}, req.ip);
    res.json({ success: true });
  } catch (error) {
    console.error('[Despesas] Reembolsar error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao marcar despesa como reembolsada' });
  }
});

// DELETE /api/despesas/:id - hard delete
router.delete('/:id', authenticateToken, requireGestor, [param('id').isInt().withMessage('ID inválido')], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const despesa = Despesa.findById(req.params.id);
    if (!despesa) return res.status(404).json({ success: false, error: 'Despesa não encontrada' });

    Despesa.delete(req.params.id);
    AuditLog.log(req.user.id, 'delete', 'despesa', parseInt(req.params.id), { descricao: despesa.descricao }, req.ip);
    res.json({ success: true });
  } catch (error) {
    console.error('[Despesas] Delete error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao excluir despesa' });
  }
});

module.exports = router;
