const express = require('express');
const { body, param, validationResult } = require('express-validator');
const path = require('path');
const multer = require('multer');
const Entrega = require('../models/Entrega');
const { authenticateToken, requireGestor } = require('../middleware/auth');
const AuditLog = require('../services/auditLog');

const router = express.Router();

// Multer config for entrega photo upload
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../public/uploads/entregas'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, 'entrega_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Apenas imagens são permitidas'));
  }
});

// GET /api/entregas
router.get('/', authenticateToken, (req, res) => {
  try {
    const { date, data_inicio, data_fim, funcionario_id, page, limit } = req.query;
    const result = Entrega.getAll({
      date,
      data_inicio,
      data_fim,
      funcionario_id: funcionario_id ? parseInt(funcionario_id) : undefined,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50
    });
    res.json(result);
  } catch (err) {
    console.error('List entregas error:', err);
    res.status(500).json({ error: 'Erro ao listar entregas' });
  }
});

// GET /api/entregas/:id
router.get('/:id', authenticateToken, [
  param('id').isInt().withMessage('ID inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const entrega = Entrega.findById(req.params.id);
    if (!entrega) return res.status(404).json({ error: 'Entrega não encontrada' });
    res.json(entrega);
  } catch (err) {
    console.error('Get entrega error:', err);
    res.status(500).json({ error: 'Erro ao buscar entrega' });
  }
});

// POST /api/entregas (JSON, sem foto)
router.post('/', authenticateToken, requireGestor, (req, res) => {
  try {
    const id = Entrega.create(req.body);
    AuditLog.log(req.user.id, 'create', 'entrega', id, req.body, req.ip);
    res.status(201).json({ id, message: 'Entrega registrada com sucesso' });
  } catch (err) {
    console.error('Create entrega error:', err);
    res.status(500).json({ error: 'Erro ao registrar entrega' });
  }
});

// POST /api/entregas/upload (com foto)
router.post('/upload', authenticateToken, requireGestor, upload.single('foto'), (req, res) => {
  try {
    const data = {
      destinatario: req.body.destinatario || null,
      remetente: req.body.remetente || null,
      transportadora: req.body.transportadora || null,
      descricao: req.body.descricao || null,
      data_hora: req.body.data_hora || null,
      funcionario_id: req.body.funcionario_id || null,
      imagem_path: req.file ? '/uploads/entregas/' + req.file.filename : null
    };
    const id = Entrega.create(data);
    AuditLog.log(req.user.id, 'create', 'entrega', id, { ...data, has_foto: !!req.file }, req.ip);
    res.status(201).json({ id, message: 'Entrega registrada com sucesso' });
  } catch (err) {
    console.error('Create entrega upload error:', err);
    res.status(500).json({ error: 'Erro ao registrar entrega' });
  }
});

// PUT /api/entregas/:id
router.put('/:id', authenticateToken, requireGestor, [
  param('id').isInt().withMessage('ID inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const entrega = Entrega.findById(req.params.id);
    if (!entrega) return res.status(404).json({ error: 'Entrega não encontrada' });
    Entrega.update(req.params.id, req.body);
    AuditLog.log(req.user.id, 'update', 'entrega', parseInt(req.params.id), req.body, req.ip);
    res.json({ message: 'Entrega atualizada com sucesso' });
  } catch (err) {
    console.error('Update entrega error:', err);
    res.status(500).json({ error: 'Erro ao atualizar entrega' });
  }
});

// DELETE /api/entregas/:id
router.delete('/:id', authenticateToken, requireGestor, [
  param('id').isInt().withMessage('ID inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const entrega = Entrega.findById(req.params.id);
    if (!entrega) return res.status(404).json({ error: 'Entrega não encontrada' });
    Entrega.delete(req.params.id);
    AuditLog.log(req.user.id, 'delete', 'entrega', parseInt(req.params.id), { destinatario: entrega.destinatario }, req.ip);
    res.json({ message: 'Entrega removida com sucesso' });
  } catch (err) {
    console.error('Delete entrega error:', err);
    res.status(500).json({ error: 'Erro ao remover entrega' });
  }
});

module.exports = router;
