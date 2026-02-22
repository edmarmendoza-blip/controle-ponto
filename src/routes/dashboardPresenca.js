const express = require('express');
const { query, validationResult } = require('express-validator');
const DashboardPresenca = require('../models/DashboardPresenca');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/dashboard/presenca/hoje
router.get('/hoje', authenticateToken, (req, res) => {
  try {
    const data = new Date().toISOString().split('T')[0];
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

module.exports = router;
