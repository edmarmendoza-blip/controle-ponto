const { db } = require('../config/database');

class EmailInbox {
  static getAll(filters = {}) {
    let where = 'WHERE 1=1';
    const params = [];
    if (filters.status) { where += ' AND status = ?'; params.push(filters.status); }
    if (filters.classificacao) { where += ' AND classificacao = ?'; params.push(filters.classificacao); }
    if (filters.dataInicio) { where += ' AND created_at >= ?'; params.push(filters.dataInicio); }
    if (filters.dataFim) { where += ' AND created_at <= ?'; params.push(filters.dataFim + ' 23:59:59'); }
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    return db.prepare(`SELECT * FROM email_inbox ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  }

  static findById(id) {
    return db.prepare('SELECT * FROM email_inbox WHERE id = ?').get(id);
  }

  static findByMessageId(messageId) {
    return db.prepare('SELECT id FROM email_inbox WHERE message_id = ?').get(messageId);
  }

  static create(data) {
    const result = db.prepare(`INSERT INTO email_inbox (message_id, from_email, from_name, subject, body_text, attachments_count, attachment_paths, classificacao, dados_extraidos, acao_sugerida, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      data.message_id, data.from_email, data.from_name, data.subject,
      data.body_text, data.attachments_count || 0, data.attachment_paths || null,
      data.classificacao || null, data.dados_extraidos || null,
      data.acao_sugerida || null, data.status || 'pendente'
    );
    return result.lastInsertRowid;
  }

  static update(id, data) {
    const fields = ['classificacao', 'dados_extraidos', 'acao_sugerida', 'acao_executada', 'status', 'whatsapp_notified'];
    const sets = [];
    const values = [];
    for (const f of fields) {
      if (data[f] !== undefined) { sets.push(`${f} = ?`); values.push(data[f]); }
    }
    if (sets.length === 0) return;
    values.push(id);
    db.prepare(`UPDATE email_inbox SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  static getPendingCount() {
    const row = db.prepare("SELECT COUNT(*) as count FROM email_inbox WHERE status = 'pendente'").get();
    return row?.count || 0;
  }
}

module.exports = EmailInbox;
