const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const AuditLog = require('../services/auditLog');

const router = express.Router();

// GET /api/audit-log
router.get('/', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { page, userId, action, entityType, startDate, endDate } = req.query;
    const result = AuditLog.getAll({
      page: parseInt(page) || 1,
      userId: userId ? parseInt(userId) : undefined,
      action: action || undefined,
      entityType: entityType || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined
    });
    res.json(result);
  } catch (err) {
    console.error('Audit log error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
