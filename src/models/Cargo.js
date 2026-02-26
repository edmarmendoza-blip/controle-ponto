const { db } = require('../config/database');

class Cargo {
  static getAll(includeInactive = false) {
    const where = includeInactive ? '' : 'WHERE ativo = 1';
    return db.prepare(`SELECT * FROM cargos ${where} ORDER BY nome`).all();
  }

  static findById(id) {
    return db.prepare('SELECT * FROM cargos WHERE id = ?').get(id);
  }

  static findByNome(nome) {
    return db.prepare('SELECT * FROM cargos WHERE nome = ?').get(nome);
  }

  static create(data) {
    const result = db.prepare(`
      INSERT INTO cargos (nome, precisa_bater_ponto, permite_hora_extra, permite_dia_extra, valor_hora_extra, valor_dia_extra, recebe_vale_transporte, valor_vale_transporte, recebe_vale_refeicao, valor_vale_refeicao, recebe_ajuda_combustivel, valor_ajuda_combustivel, dorme_no_local, dias_dormida, tipo_dias_dormida, aparece_relatorios)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.nome,
      data.precisa_bater_ponto ?? 1,
      data.permite_hora_extra ?? 1,
      data.permite_dia_extra ?? 0,
      data.valor_hora_extra ?? 0,
      data.valor_dia_extra ?? 0,
      data.recebe_vale_transporte ?? 1,
      data.valor_vale_transporte ?? 0,
      data.recebe_vale_refeicao ?? 0,
      data.valor_vale_refeicao ?? 0,
      data.recebe_ajuda_combustivel ?? 0,
      data.valor_ajuda_combustivel ?? 0,
      data.dorme_no_local ?? 0,
      data.dias_dormida ?? 0,
      data.tipo_dias_dormida || 'semana',
      data.aparece_relatorios ?? 1
    );
    return result.lastInsertRowid;
  }

  static update(id, data) {
    const fields = [];
    const values = [];
    const allowed = [
      'nome', 'precisa_bater_ponto', 'permite_hora_extra', 'permite_dia_extra',
      'valor_hora_extra', 'valor_dia_extra', 'recebe_vale_transporte', 'valor_vale_transporte',
      'recebe_vale_refeicao', 'valor_vale_refeicao', 'recebe_ajuda_combustivel', 'valor_ajuda_combustivel',
      'dorme_no_local', 'dias_dormida', 'tipo_dias_dormida', 'ativo', 'aparece_relatorios'
    ];
    for (const [key, value] of Object.entries(data)) {
      if (allowed.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    if (fields.length === 0) return null;
    fields.push("updated_at = datetime('now','localtime')");
    values.push(id);
    return db.prepare(`UPDATE cargos SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  static delete(id) {
    // Soft delete - just deactivate
    return db.prepare("UPDATE cargos SET ativo = 0, updated_at = datetime('now','localtime') WHERE id = ?").run(id);
  }
}

module.exports = Cargo;
