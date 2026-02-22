const { db } = require('../config/database');

class Registro {
  static findById(id) {
    return db.prepare(`
      SELECT r.*, f.nome as funcionario_nome, f.cargo
      FROM registros r
      JOIN funcionarios f ON r.funcionario_id = f.id
      WHERE r.id = ?
    `).get(id);
  }

  static getByDate(data, funcionarioId = null) {
    let query = `
      SELECT r.*, f.nome as funcionario_nome, f.cargo, f.salario_hora
      FROM registros r
      JOIN funcionarios f ON r.funcionario_id = f.id
      WHERE r.data = ?
    `;
    const params = [data];
    if (funcionarioId) {
      query += ' AND r.funcionario_id = ?';
      params.push(funcionarioId);
    }
    query += ' ORDER BY f.nome, r.entrada';
    return db.prepare(query).all(...params);
  }

  static getByPeriod(dataInicio, dataFim, funcionarioId = null) {
    let query = `
      SELECT r.*, f.nome as funcionario_nome, f.cargo, f.salario_hora
      FROM registros r
      JOIN funcionarios f ON r.funcionario_id = f.id
      WHERE r.data BETWEEN ? AND ?
    `;
    const params = [dataInicio, dataFim];
    if (funcionarioId) {
      query += ' AND r.funcionario_id = ?';
      params.push(funcionarioId);
    }
    query += ' ORDER BY r.data, f.nome, r.entrada';
    return db.prepare(query).all(...params);
  }

  static create({ funcionario_id, data, entrada, saida, tipo = 'manual', observacao, created_by, latitude, longitude }) {
    // Check for duplicate
    const existing = db.prepare(
      'SELECT id FROM registros WHERE funcionario_id = ? AND data = ? AND entrada = ?'
    ).get(funcionario_id, data, entrada);

    if (existing) {
      throw new Error('Já existe um registro para este funcionário nesta data/horário');
    }

    const result = db.prepare(
      'INSERT INTO registros (funcionario_id, data, entrada, saida, tipo, observacao, created_by, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(funcionario_id, data, entrada || null, saida || null, tipo, observacao || null, created_by, latitude || null, longitude || null);
    return result.lastInsertRowid;
  }

  static update(id, data, updatedBy) {
    const fields = [];
    const values = [];
    const allowed = ['entrada', 'saida', 'observacao', 'data', 'funcionario_id', 'latitude', 'longitude'];
    for (const [key, value] of Object.entries(data)) {
      if (allowed.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    if (fields.length === 0) return null;
    fields.push('updated_by = ?');
    values.push(updatedBy);
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    return db.prepare(`UPDATE registros SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  static delete(id) {
    return db.prepare('DELETE FROM registros WHERE id = ?').run(id);
  }

  static getMonthlyReport(mes, ano, funcionarioId = null) {
    const dataInicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const lastDay = new Date(ano, mes, 0).getDate();
    const dataFim = `${ano}-${String(mes).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    let query = `
      SELECT r.*, f.nome as funcionario_nome, f.cargo, f.salario_hora
      FROM registros r
      JOIN funcionarios f ON r.funcionario_id = f.id
      WHERE r.data BETWEEN ? AND ?
    `;
    const params = [dataInicio, dataFim];
    if (funcionarioId) {
      query += ' AND r.funcionario_id = ?';
      params.push(parseInt(funcionarioId));
    }
    query += ' ORDER BY f.nome, r.data, r.entrada';
    return db.prepare(query).all(...params);
  }

  static getDashboardSummary(data) {
    return db.prepare(`
      SELECT
        f.id as funcionario_id,
        f.nome,
        f.cargo,
        f.salario_hora,
        r.id as registro_id,
        r.entrada,
        r.saida,
        r.tipo,
        CASE
          WHEN r.entrada IS NOT NULL AND r.saida IS NULL THEN 'trabalhando'
          WHEN r.entrada IS NOT NULL AND r.saida IS NOT NULL THEN 'saiu'
          ELSE 'nao_registrou'
        END as status_atual
      FROM funcionarios f
      LEFT JOIN registros r ON f.id = r.funcionario_id AND r.data = ?
      WHERE f.status = 'ativo'
      ORDER BY f.nome
    `).all(data);
  }
}

module.exports = Registro;
