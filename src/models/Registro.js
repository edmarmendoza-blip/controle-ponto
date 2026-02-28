const { db } = require('../config/database');

const BASE_SELECT_COLUMNS = `
  r.*, f.nome as funcionario_nome, COALESCE(c.nome, f.cargo) as cargo,
  COALESCE(NULLIF(f.salario_hora, 0), c.valor_hora_extra, 0) as salario_hora,
  COALESCE(NULLIF(f.valor_hora_extra, 0), c.valor_hora_extra, 0) as func_valor_hora_extra,
  f.cargo_id, f.contabiliza_hora_extra,
  c.precisa_bater_ponto as cargo_precisa_bater_ponto,
  c.permite_hora_extra as cargo_permite_hora_extra,
  c.permite_dia_extra as cargo_permite_dia_extra`;

const BASE_JOIN = `
  FROM registros r
  JOIN funcionarios f ON r.funcionario_id = f.id
  LEFT JOIN cargos c ON f.cargo_id = c.id`;

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
    let query = `SELECT ${BASE_SELECT_COLUMNS} ${BASE_JOIN} WHERE r.data = ?`;
    const params = [data];
    if (funcionarioId) {
      query += ' AND r.funcionario_id = ?';
      params.push(funcionarioId);
    }
    query += ' ORDER BY f.nome, r.entrada';
    return db.prepare(query).all(...params);
  }

  static getByPeriod(dataInicio, dataFim, funcionarioId = null) {
    let query = `SELECT ${BASE_SELECT_COLUMNS} ${BASE_JOIN} WHERE r.data BETWEEN ? AND ?`;
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
    fields.push("updated_at = datetime('now','localtime')");
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

    let query = `SELECT ${BASE_SELECT_COLUMNS} ${BASE_JOIN} WHERE r.data BETWEEN ? AND ?`;
    const params = [dataInicio, dataFim];
    if (funcionarioId) {
      query += ' AND r.funcionario_id = ?';
      params.push(parseInt(funcionarioId));
    }
    query += ' ORDER BY f.nome, r.data, r.entrada';
    return db.prepare(query).all(...params);
  }

  static getDashboardSummary(data) {
    const rows = db.prepare(`
      SELECT
        f.id as funcionario_id,
        f.nome,
        COALESCE(c.nome, f.cargo) as cargo,
        f.salario_hora,
        r.id as registro_id,
        r.entrada,
        r.saida,
        r.tipo,
        r.observacao
      FROM funcionarios f
      LEFT JOIN cargos c ON f.cargo_id = c.id
      LEFT JOIN registros r ON f.id = r.funcionario_id AND r.data = ?
      WHERE f.status = 'ativo'
        AND (c.aparece_relatorios = 1 OR c.id IS NULL)
      ORDER BY f.nome
    `).all(data);

    // Consolidate: 1 row per employee
    const funcMap = {};
    for (const row of rows) {
      if (!funcMap[row.funcionario_id]) {
        funcMap[row.funcionario_id] = {
          funcionario_id: row.funcionario_id,
          nome: row.nome,
          cargo: row.cargo,
          salario_hora: row.salario_hora,
          entrada: null,
          saida: null,
          tipo: row.tipo
        };
      }
      const f = funcMap[row.funcionario_id];
      if (row.entrada || row.saida) {
        const obs = (row.observacao || '').toLowerCase();
        const isAlmoco = obs.includes('almoço') || obs.includes('almoco');
        if (!isAlmoco) {
          if (row.entrada && (!f.entrada || row.entrada < f.entrada)) f.entrada = row.entrada;
          if (row.saida && (!f.saida || row.saida > f.saida)) f.saida = row.saida;
        }
        if (row.tipo) f.tipo = row.tipo;
      }
    }

    return Object.values(funcMap).map(f => {
      let status_atual = 'nao_registrou';
      if (f.entrada && f.saida) status_atual = 'saiu';
      else if (f.entrada) status_atual = 'trabalhando';
      return { ...f, status_atual };
    });
  }
}

module.exports = Registro;
