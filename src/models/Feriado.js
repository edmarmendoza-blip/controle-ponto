const { db } = require('../config/database');

class Feriado {
  static getAll(ano = null) {
    if (ano) {
      return db.prepare('SELECT * FROM feriados WHERE ano = ? ORDER BY data').all(ano);
    }
    return db.prepare('SELECT * FROM feriados ORDER BY data DESC').all();
  }

  static findById(id) {
    return db.prepare('SELECT * FROM feriados WHERE id = ?').get(id);
  }

  static isHoliday(data) {
    return db.prepare('SELECT * FROM feriados WHERE data = ?').get(data) || null;
  }

  static create({ data, descricao, tipo, ano, recorrente = 1 }) {
    const result = db.prepare(
      'INSERT INTO feriados (data, descricao, tipo, ano, recorrente) VALUES (?, ?, ?, ?, ?)'
    ).run(data, descricao, tipo, ano, recorrente ? 1 : 0);
    return result.lastInsertRowid;
  }

  static update(id, data) {
    const fields = [];
    const values = [];
    const allowed = ['data', 'descricao', 'tipo', 'ano', 'recorrente'];
    for (const [key, value] of Object.entries(data)) {
      if (allowed.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    if (fields.length === 0) return null;
    values.push(id);
    return db.prepare(`UPDATE feriados SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  static delete(id) {
    return db.prepare('DELETE FROM feriados WHERE id = ?').run(id);
  }
}

module.exports = Feriado;
