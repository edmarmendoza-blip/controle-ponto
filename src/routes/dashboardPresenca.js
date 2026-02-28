const express = require('express');
const { query, validationResult } = require('express-validator');
const DashboardPresenca = require('../models/DashboardPresenca');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { db } = require('../config/database');

const router = express.Router();

// GET /api/dashboard/presenca/hoje
router.get('/hoje', authenticateToken, (req, res) => {
  try {
    const data = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const result = DashboardPresenca.getPresencaHoje(data);
    res.json(result);
  } catch (err) {
    console.error('Dashboard presenca hoje error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/dashboard/presenca/mensal
router.get('/mensal', authenticateToken, [
  query('mes').isInt({ min: 1, max: 12 }).withMessage('Mês inválido (1-12)'),
  query('ano').isInt({ min: 2020, max: 2099 }).withMessage('Ano inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { mes, ano } = req.query;
    const result = DashboardPresenca.getPresencaMensal(mes, ano);
    res.json(result);
  } catch (err) {
    console.error('Dashboard presenca mensal error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/dashboard/presenca/pendencias — expired/pending confirmations (admin only)
router.get('/pendencias', authenticateToken, requireAdmin, (req, res) => {
  try {
    // Get expired confirmations from last 48h + currently pending
    const items = db.prepare(`
      SELECT pc.id, pc.tipo, pc.data, pc.horario, pc.message_text, pc.status,
             pc.created_at, pc.resolved_at,
             f.nome as funcionario_nome
      FROM pending_confirmations pc
      LEFT JOIN funcionarios f ON pc.funcionario_id = f.id
      WHERE (pc.status = 'expired' AND pc.created_at >= datetime('now','localtime','-48 hours'))
         OR pc.status = 'pending'
      ORDER BY pc.created_at DESC
      LIMIT 50
    `).all();

    // Summary counts
    const counts = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'expired' AND created_at >= datetime('now','localtime','-24 hours') THEN 1 ELSE 0 END) as expired_24h,
        SUM(CASE WHEN status = 'expired' AND created_at >= datetime('now','localtime','-48 hours') THEN 1 ELSE 0 END) as expired_48h,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
      FROM pending_confirmations
    `).get();

    res.json({
      items,
      resumo: {
        expired_24h: counts?.expired_24h || 0,
        expired_48h: counts?.expired_48h || 0,
        pending: counts?.pending || 0
      }
    });
  } catch (err) {
    console.error('Dashboard pendencias error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/dashboard/presenca/check-ausencias — trigger absence check manually (admin only)
router.post('/check-ausencias', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const Schedulers = require('../services/schedulers');
    const result = await Schedulers.checkAbsences();
    res.json(result);
  } catch (err) {
    console.error('Check ausencias error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
