const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const InsightsIA = require('../services/insightsIA');

// GET /api/insights - Lista paginada
router.get('/', authenticateToken, requireAdmin, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const result = InsightsIA.getAll(page, limit);
    res.json(result);
  } catch (err) {
    console.error('[Insights] List error:', err.message);
    res.status(500).json({ error: 'Erro ao buscar insights' });
  }
});

// GET /api/insights/:date - Busca por data
router.get('/:date', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Data inválida. Use formato YYYY-MM-DD' });
    }
    const insight = InsightsIA.getByDate(date);
    if (!insight) {
      return res.status(404).json({ error: 'Nenhum insight encontrado para esta data' });
    }
    res.json(insight);
  } catch (err) {
    console.error('[Insights] Get error:', err.message);
    res.status(500).json({ error: 'Erro ao buscar insight' });
  }
});

// POST /api/insights/generate - Gerar insights para uma data
router.post('/generate', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const date = req.body.date || new Date().toISOString().split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Data inválida. Use formato YYYY-MM-DD' });
    }
    const result = await InsightsIA.generateDailyInsights(date);
    if (!result.success) {
      return res.status(404).json({ error: result.message });
    }
    res.json(result);
  } catch (err) {
    console.error('[Insights] Generate error:', err.message);
    res.status(500).json({ error: 'Erro ao gerar insights: ' + err.message });
  }
});

// POST /api/insights/generate-period - Gerar insights para um período
router.post('/generate-period', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const endDate = req.body.endDate || today;
    // Default: 30 days back
    const defaultStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const startDate = req.body.startDate || defaultStart;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return res.status(400).json({ error: 'Datas inválidas. Use formato YYYY-MM-DD' });
    }
    const result = await InsightsIA.generatePeriodInsights(startDate, endDate);
    if (!result.success) {
      return res.status(404).json({ error: result.message });
    }
    res.json(result);
  } catch (err) {
    console.error('[Insights] Generate period error:', err.message);
    res.status(500).json({ error: 'Erro ao gerar insights do período: ' + err.message });
  }
});

module.exports = router;
