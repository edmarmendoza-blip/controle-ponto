const { db } = require('../config/database');

const ALL_FIELDS = [
  'nome', 'cargo', 'salario_hora', 'telefone', 'foto', 'status', 'horario_entrada',
  'valor_hora_extra', 'valor_dia_especial', 'jornada_diaria',
  'classificacao', 'email_pessoal', 'data_admissao', 'data_desligamento', 'motivo_desligamento',
  'contabiliza_hora_extra', 'recebe_vt', 'recebe_va', 'contabiliza_feriado',
  'jornada_texto', 'jornada_json',
  'tipo_transporte', 'valor_fixo_transporte',
  'tem_vale_alimentacao', 'valor_va_dia',
  'pix_tipo', 'pix_chave', 'pix_banco',
  'ferias_inicio', 'ferias_fim', 'ferias_status',
  'notificacoes_ativas', 'notificacoes_config'
];

class Funcionario {
  static getAll(includeInactive = false) {
    const where = includeInactive ? '' : "WHERE status = 'ativo'";
    return db.prepare(`SELECT * FROM funcionarios ${where} ORDER BY nome`).all();
  }

  static findById(id) {
    const func = db.prepare('SELECT * FROM funcionarios WHERE id = ?').get(id);
    if (func) {
      func.transportes = this.getTransportes(id);
    }
    return func;
  }

  static create(data) {
    const fields = ['nome'];
    const placeholders = ['?'];
    const values = [data.nome];

    for (const key of ALL_FIELDS) {
      if (key === 'nome') continue;
      if (data[key] !== undefined && data[key] !== null) {
        fields.push(key);
        placeholders.push('?');
        values.push(data[key]);
      }
    }

    const result = db.prepare(
      `INSERT INTO funcionarios (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`
    ).run(...values);

    const funcId = result.lastInsertRowid;

    // Handle transportes sub-table
    if (data.transportes && Array.isArray(data.transportes)) {
      for (const t of data.transportes) {
        this.addTransporte(funcId, t);
      }
    }

    return funcId;
  }

  static update(id, data) {
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(data)) {
      if (ALL_FIELDS.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value === '' ? null : value);
      }
    }
    if (fields.length === 0 && !data.transportes) return null;

    if (fields.length > 0) {
      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);
      db.prepare(`UPDATE funcionarios SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    // Handle transportes update (replace all)
    if (data.transportes && Array.isArray(data.transportes)) {
      this.replaceTransportes(id, data.transportes);
    }

    return { changes: fields.length };
  }

  static delete(id) {
    return db.prepare("UPDATE funcionarios SET status = 'desligado', data_desligamento = date('now'), updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  }

  static desligar(id, motivo) {
    return db.prepare(
      "UPDATE funcionarios SET status = 'desligado', data_desligamento = date('now'), motivo_desligamento = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(motivo || null, id);
  }

  static search(query) {
    return db.prepare(
      "SELECT * FROM funcionarios WHERE nome LIKE ? AND status = 'ativo' ORDER BY nome"
    ).all(`%${query}%`);
  }

  // --- Transportes sub-table ---
  static getTransportes(funcionarioId) {
    return db.prepare('SELECT * FROM funcionario_transportes WHERE funcionario_id = ? ORDER BY id').all(funcionarioId);
  }

  static addTransporte(funcionarioId, { tipo, nome_linha, valor_trecho }) {
    return db.prepare(
      'INSERT INTO funcionario_transportes (funcionario_id, tipo, nome_linha, valor_trecho) VALUES (?, ?, ?, ?)'
    ).run(funcionarioId, tipo, nome_linha || null, valor_trecho || 0);
  }

  static removeTransporte(id) {
    return db.prepare('DELETE FROM funcionario_transportes WHERE id = ?').run(id);
  }

  static replaceTransportes(funcionarioId, transportes) {
    db.prepare('DELETE FROM funcionario_transportes WHERE funcionario_id = ?').run(funcionarioId);
    for (const t of transportes) {
      this.addTransporte(funcionarioId, t);
    }
  }

  static calcularVT(funcionarioId, diasTrabalhados) {
    const func = db.prepare('SELECT tipo_transporte, valor_fixo_transporte FROM funcionarios WHERE id = ?').get(funcionarioId);
    if (!func) return 0;

    if (func.tipo_transporte === 'fixo') {
      return func.valor_fixo_transporte || 0;
    }

    const transportes = this.getTransportes(funcionarioId);
    const somaVT = transportes.reduce((acc, t) => acc + (t.valor_trecho || 0), 0);

    if (func.tipo_transporte === 'diario') {
      // ida e volta por dia: soma_trechos * 2 * dias
      return Math.round(somaVT * 2 * diasTrabalhados * 100) / 100;
    }
    if (func.tipo_transporte === 'pernoite') {
      // só ida no primeiro e volta no último: soma_trechos * 2
      return Math.round(somaVT * 2 * 100) / 100;
    }
    return 0;
  }
}

module.exports = Funcionario;
