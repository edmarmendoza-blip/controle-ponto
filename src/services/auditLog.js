const { db } = require('../config/database');

class AuditLog {
  static log(userId, action, entityType, entityId, details, ip) {
    try {
      db.prepare(
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(userId, action, entityType, entityId || null, details ? JSON.stringify(details) : null, ip || null);
    } catch (err) {
      console.error('Audit log error:', err);
    }
  }

  static getAll({ page = 1, limit = 50, userId, action, entityType, startDate, endDate } = {}) {
    let query = `
      SELECT al.*, u.name as user_name, u.email as user_email
      FROM audit_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (userId) {
      query += ' AND al.user_id = ?';
      params.push(userId);
    }
    if (action) {
      query += ' AND al.action = ?';
      params.push(action);
    }
    if (entityType) {
      query += ' AND al.entity_type = ?';
      params.push(entityType);
    }
    if (startDate) {
      query += ' AND al.created_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND al.created_at <= ? ';
      params.push(endDate + ' 23:59:59');
    }

    const countQuery = query.replace('SELECT al.*, u.name as user_name, u.email as user_email', 'SELECT COUNT(*) as total');
    const total = db.prepare(countQuery).get(...params).total;

    query += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, (page - 1) * limit);

    const logs = db.prepare(query).all(...params);
    return { logs, total, page, limit, pages: Math.ceil(total / limit) };
  }
}

module.exports = AuditLog;
