const { db } = require('../config/database');

class Funcionario {
  static getAll(includeInactive = false) {
    const where = includeInactive ? '' : "WHERE status = 'ativo'";
    return db.prepare(`SELECT * FROM funcionarios ${where} ORDER BY nome`).all();
  }

  static findById(id) {
    return db.prepare('SELECT * FROM funcionarios WHERE id = ?').get(id);
  }

  static create({ nome, cargo, salario_hora, telefone, foto, status = 'ativo', horario_entrada = '08:00' }) {
    const result = db.prepare(
      'INSERT INTO funcionarios (nome, cargo, salario_hora, telefone, foto, status, horario_entrada) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(nome, cargo, salario_hora, telefone || null, foto || null, status, horario_entrada);
    return result.lastInsertRowid;
  }

  static update(id, data) {
    const fields = [];
    const values = [];
    const allowed = ['nome', 'cargo', 'salario_hora', 'telefone', 'foto', 'status', 'horario_entrada'];
    for (const [key, value] of Object.entries(data)) {
      if (allowed.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    if (fields.length === 0) return null;
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    return db.prepare(`UPDATE funcionarios SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  static delete(id) {
    return db.prepare("UPDATE funcionarios SET status = 'inativo', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  }

  static search(query) {
    return db.prepare(
      "SELECT * FROM funcionarios WHERE nome LIKE ? AND status = 'ativo' ORDER BY nome"
    ).all(`%${query}%`);
  }
}

module.exports = Funcionario;
