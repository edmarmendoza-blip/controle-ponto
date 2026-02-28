const express = require('express');
const { authenticateToken, requireGestor } = require('../middleware/auth');
const EmailInbox = require('../models/EmailInbox');

const router = express.Router();

// GET /api/emails - List emails
router.get('/', authenticateToken, (req, res) => {
  try {
    const { status, classificacao, dataInicio, dataFim, limit, offset } = req.query;
    const emails = EmailInbox.getAll({ status, classificacao, dataInicio, dataFim, limit: parseInt(limit) || 50, offset: parseInt(offset) || 0 });
    res.json({ success: true, data: emails });
  } catch (error) {
    console.error('[EmailInbox] List error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao listar emails' });
  }
});

// GET /api/emails/:id - Get email detail
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const email = EmailInbox.findById(req.params.id);
    if (!email) return res.status(404).json({ success: false, error: 'Email não encontrado' });
    res.json({ success: true, data: email });
  } catch (error) {
    console.error('[EmailInbox] Get error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao buscar email' });
  }
});

// PUT /api/emails/:id - Update email status/action
router.put('/:id', authenticateToken, requireGestor, (req, res) => {
  try {
    const email = EmailInbox.findById(req.params.id);
    if (!email) return res.status(404).json({ success: false, error: 'Email não encontrado' });
    EmailInbox.update(req.params.id, req.body);
    res.json({ success: true });
  } catch (error) {
    console.error('[EmailInbox] Update error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao atualizar email' });
  }
});

module.exports = router;
