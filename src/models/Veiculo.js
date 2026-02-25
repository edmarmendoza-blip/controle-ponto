const { db } = require('../config/database');

const ALL_FIELDS = [
  'marca', 'modelo', 'ano_fabricacao', 'ano_modelo', 'cor', 'placa', 'renavam', 'chassi',
  'combustivel', 'km_atual', 'seguradora', 'seguro_apolice', 'seguro_vigencia_inicio',
  'seguro_vigencia_fim', 'seguro_valor', 'ipva_valor', 'ipva_vencimento', 'ipva_status',
  'licenciamento_ano', 'licenciamento_status', 'ultima_revisao_data', 'ultima_revisao_km',
  'proxima_revisao_data', 'proxima_revisao_km', 'responsavel_id', 'crlv_foto_path',
  'observacoes', 'status'
];

class Veiculo {
  static getAll(includeInactive = false) {
    const where = includeInactive ? '' : "WHERE v.status = 'ativo'";
    return db.prepare(`
      SELECT v.*, f.nome as responsavel_nome
      FROM veiculos v
      LEFT JOIN funcionarios f ON v.responsavel_id = f.id
      ${where}
      ORDER BY v.marca, v.modelo
    `).all();
  }

  static findById(id) {
    return db.prepare(`
      SELECT v.*, f.nome as responsavel_nome
      FROM veiculos v
      LEFT JOIN funcionarios f ON v.responsavel_id = f.id
      WHERE v.id = ?
    `).get(id);
  }

  static findByPlaca(placa) {
    return db.prepare('SELECT * FROM veiculos WHERE placa = ?').get(placa);
  }

  static create(data) {
    const fields = [];
    const placeholders = [];
    const values = [];

    for (const key of ALL_FIELDS) {
      if (data[key] !== undefined && data[key] !== null && data[key] !== '') {
        fields.push(key);
        placeholders.push('?');
        values.push(data[key]);
      }
    }

    if (fields.length === 0) return null;

    const result = db.prepare(
      `INSERT INTO veiculos (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`
    ).run(...values);

    return result.lastInsertRowid;
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
    if (fields.length === 0) return null;

    fields.push("updated_at = datetime('now','localtime')");
    values.push(id);
    return db.prepare(`UPDATE veiculos SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  static delete(id) {
    return db.prepare("UPDATE veiculos SET status = 'inativo', updated_at = datetime('now','localtime') WHERE id = ?").run(id);
  }

  static getAlerts() {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const in30days = new Date(Date.now() + 30 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const alerts = [];

    // IPVA vencendo
    const ipva = db.prepare(`
      SELECT * FROM veiculos WHERE status = 'ativo' AND ipva_vencimento IS NOT NULL
      AND ipva_vencimento <= ? AND ipva_status != 'pago'
    `).all(in30days);
    for (const v of ipva) {
      alerts.push({ tipo: 'ipva', veiculo: `${v.marca} ${v.modelo}`, placa: v.placa, data: v.ipva_vencimento, vencido: v.ipva_vencimento < today });
    }

    // Revisão próxima (por data)
    const revisao = db.prepare(`
      SELECT * FROM veiculos WHERE status = 'ativo' AND proxima_revisao_data IS NOT NULL
      AND proxima_revisao_data <= ?
    `).all(in30days);
    for (const v of revisao) {
      alerts.push({ tipo: 'revisao', veiculo: `${v.marca} ${v.modelo}`, placa: v.placa, data: v.proxima_revisao_data, vencido: v.proxima_revisao_data < today });
    }

    // Revisão próxima (por km)
    const revisaoKm = db.prepare(`
      SELECT * FROM veiculos WHERE status = 'ativo' AND proxima_revisao_km IS NOT NULL
      AND km_atual >= proxima_revisao_km - 1000
    `).all();
    for (const v of revisaoKm) {
      alerts.push({ tipo: 'revisao_km', veiculo: `${v.marca} ${v.modelo}`, placa: v.placa, km_atual: v.km_atual, proxima_km: v.proxima_revisao_km });
    }

    return alerts;
  }
}

module.exports = Veiculo;
