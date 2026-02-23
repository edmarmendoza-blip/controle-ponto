const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const HoleriteIMAP = require('../services/holeriteIMAP');

const router = express.Router();

// POST /api/holerites/sync - Sync holerites from IMAP
router.post('/sync', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await HoleriteIMAP.sync();
    res.json(result);
  } catch (err) {
    console.error('[Holerites] Sync error:', err.message);
    res.status(500).json({ error: 'Erro ao sincronizar holerites: ' + err.message });
  }
});

// GET /api/holerites/emails - List holerites from email
router.get('/emails', authenticateToken, (req, res) => {
  try {
    const holerites = HoleriteIMAP.getAll();
    res.json(holerites);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar holerites' });
  }
});

// PUT /api/holerites/emails/:id/link - Link holerite to employee
router.put('/emails/:id/link', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { funcionario_id } = req.body;
    if (!funcionario_id) return res.status(400).json({ error: 'funcionario_id obrigatório' });
    HoleriteIMAP.linkToEmployee(req.params.id, funcionario_id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao vincular holerite' });
  }
});

module.exports = router;
