const { db } = require('../config/database');

class Entrega {
  static getAll({ date, data_inicio, data_fim, funcionario_id, page = 1, limit = 50 } = {}) {
    let query = `
      SELECT e.*, f.nome as funcionario_nome
      FROM entregas e
      LEFT JOIN funcionarios f ON e.funcionario_id = f.id
      WHERE 1=1
    `;
    const params = [];

    if (date) {
      query += " AND date(e.data_hora) = ?";
      params.push(date);
    }
    if (data_inicio) {
      query += " AND date(e.data_hora) >= ?";
      params.push(data_inicio);
    }
    if (data_fim) {
      query += " AND date(e.data_hora) <= ?";
      params.push(data_fim);
    }
    if (funcionario_id) {
      query += ' AND e.funcionario_id = ?';
      params.push(funcionario_id);
    }

    const countQuery = query.replace(/SELECT e\.\*, f\.nome as funcionario_nome/, 'SELECT COUNT(*) as total');
    const total = db.prepare(countQuery).get(...params).total;

    query += ' ORDER BY e.data_hora DESC LIMIT ? OFFSET ?';
    params.push(limit, (page - 1) * limit);

    const entregas = db.prepare(query).all(...params);
    return { entregas, total, page, limit, pages: Math.ceil(total / limit) };
  }

  static findById(id) {
    return db.prepare(`
      SELECT e.*, f.nome as funcionario_nome
      FROM entregas e
      LEFT JOIN funcionarios f ON e.funcionario_id = f.id
      WHERE e.id = ?
    `).get(id);
  }

  static create(data) {
    const result = db.prepare(`
      INSERT INTO entregas (funcionario_id, data_hora, imagem_path, destinatario, remetente, transportadora, descricao, whatsapp_mensagem_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.funcionario_id || null,
      data.data_hora || new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace('T', ' '),
      data.imagem_path || null,
      data.destinatario || null,
      data.remetente || null,
      data.transportadora || null,
      data.descricao || null,
      data.whatsapp_mensagem_id || null
    );
    return result.lastInsertRowid;
  }

  static update(id, data) {
    const fields = [];
    const values = [];
    const allowed = ['funcionario_id', 'data_hora', 'imagem_path', 'destinatario', 'remetente', 'transportadora', 'descricao'];
    for (const [key, value] of Object.entries(data)) {
      if (allowed.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    if (fields.length === 0) return null;
    fields.push("updated_at = datetime('now','localtime')");
    values.push(id);
    return db.prepare(`UPDATE entregas SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  static delete(id) {
    return db.prepare('DELETE FROM entregas WHERE id = ?').run(id);
  }
}

module.exports = Entrega;
