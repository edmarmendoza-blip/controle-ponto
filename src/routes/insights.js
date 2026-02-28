const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const InsightsIA = require('../services/insightsIA');

// Helper: current date in São Paulo timezone (YYYY-MM-DD)
function spDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

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
    const date = req.body.date || spDate();
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
    res.status(500).json({ error: 'Erro ao gerar insights' });
  }
});

// POST /api/insights/generate-period - Gerar insights para um período
router.post('/generate-period', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const today = spDate();
    const endDate = req.body.endDate || today;
    // Default: 30 days back
    const defaultStart = spDate(-30);
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
    res.status(500).json({ error: 'Erro ao gerar insights do período' });
  }
});

// POST /api/insights/generate-melhorias - Gerar insights de melhorias do sistema
router.post('/generate-melhorias', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await InsightsIA.generateMelhoriasInsights();
    if (!result.success) {
      return res.status(404).json({ error: result.message });
    }
    res.json(result);
  } catch (err) {
    console.error('[Insights] Generate melhorias error:', err.message);
    res.status(500).json({ error: 'Erro ao gerar insights de melhorias' });
  }
});

module.exports = router;
