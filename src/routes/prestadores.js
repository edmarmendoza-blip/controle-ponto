const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken, requireGestor } = require('../middleware/auth');
const Prestador = require('../models/Prestador');
const { db } = require('../config/database');

// Multer for comprovante upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'public', 'uploads', 'prestadores', String(req.params.id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `comprovante-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// GET /api/prestadores - List all
router.get('/', authenticateToken, (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const prestadores = Prestador.getAll(includeInactive);
    res.json({ success: true, data: prestadores });
  } catch (error) {
    console.error('[Prestadores] List error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao listar prestadores' });
  }
});

// GET /api/prestadores/:id - Get details
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const prestador = Prestador.findById(req.params.id);
    if (!prestador) return res.status(404).json({ success: false, error: 'Prestador não encontrado' });
    res.json({ success: true, data: prestador });
  } catch (error) {
    console.error('[Prestadores] Get error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao buscar prestador' });
  }
});

// POST /api/prestadores - Create
router.post('/', authenticateToken, requireGestor, (req, res) => {
  try {
    const { nome } = req.body;
    if (!nome) return res.status(400).json({ success: false, error: 'Nome é obrigatório' });
    const id = Prestador.create(req.body);
    db.prepare(`INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'criar_prestador', 'prestador', ?, ?, ?)`).run(req.user.id, id, JSON.stringify({ nome }), req.ip);
    res.json({ success: true, data: { id } });
  } catch (error) {
    console.error('[Prestadores] Create error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao criar prestador' });
  }
});

// PUT /api/prestadores/:id - Update
router.put('/:id', authenticateToken, requireGestor, (req, res) => {
  try {
    const prestador = Prestador.findById(req.params.id);
    if (!prestador) return res.status(404).json({ success: false, error: 'Prestador não encontrado' });
    Prestador.update(req.params.id, req.body);
    res.json({ success: true });
  } catch (error) {
    console.error('[Prestadores] Update error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao atualizar prestador' });
  }
});

// DELETE /api/prestadores/:id - Soft delete
router.delete('/:id', authenticateToken, requireGestor, (req, res) => {
  try {
    Prestador.delete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('[Prestadores] Delete error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao excluir prestador' });
  }
});

// GET /api/prestadores/:id/visitas - List visitas
router.get('/:id/visitas', authenticateToken, (req, res) => {
  try {
    const visitas = Prestador.getVisitas(req.params.id);
    res.json({ success: true, data: visitas });
  } catch (error) {
    console.error('[Prestadores] Visitas error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao listar visitas' });
  }
});

// POST /api/prestadores/:id/visitas - Create visita
router.post('/:id/visitas', authenticateToken, requireGestor, (req, res) => {
  try {
    const id = Prestador.createVisita({ ...req.body, prestador_id: req.params.id });
    res.json({ success: true, data: { id } });
  } catch (error) {
    console.error('[Prestadores] Create visita error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao registrar visita' });
  }
});

// GET /api/prestadores/:id/pagamentos - List pagamentos
router.get('/:id/pagamentos', authenticateToken, (req, res) => {
  try {
    const pagamentos = Prestador.getPagamentos(req.params.id);
    res.json({ success: true, data: pagamentos });
  } catch (error) {
    console.error('[Prestadores] Pagamentos error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao listar pagamentos' });
  }
});

// POST /api/prestadores/:id/pagamentos - Create pagamento with optional comprovante
router.post('/:id/pagamentos', authenticateToken, requireGestor, upload.single('comprovante'), (req, res) => {
  try {
    const data = { ...req.body, prestador_id: req.params.id };
    if (req.file) {
      data.comprovante_path = `/uploads/prestadores/${req.params.id}/${req.file.filename}`;
    }
    const id = Prestador.createPagamento(data);
    res.json({ success: true, data: { id } });
  } catch (error) {
    console.error('[Prestadores] Create pagamento error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao registrar pagamento' });
  }
});

module.exports = router;
