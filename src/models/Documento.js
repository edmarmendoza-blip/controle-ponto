const { db } = require('../config/database');

class Documento {
  static getAll(filters = {}) {
    let where = [];
    let params = [];
    if (filters.tipo) { where.push('d.tipo = ?'); params.push(filters.tipo); }
    if (filters.entidade_tipo) { where.push('d.entidade_tipo = ?'); params.push(filters.entidade_tipo); }
    if (filters.entidade_id) { where.push('d.entidade_id = ?'); params.push(filters.entidade_id); }
    if (filters.dataInicio) { where.push('d.created_at >= ?'); params.push(filters.dataInicio); }
    if (filters.dataFim) { where.push('d.created_at <= ?'); params.push(filters.dataFim + ' 23:59:59'); }
    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
    return db.prepare(`
      SELECT d.*,
        CASE WHEN d.entidade_tipo = 'funcionario' THEN f.nome
             WHEN d.entidade_tipo = 'veiculo' THEN (v.marca || ' ' || v.modelo || ' - ' || v.placa)
             ELSE NULL END as entidade_nome
      FROM documentos d
      LEFT JOIN funcionarios f ON d.entidade_tipo = 'funcionario' AND d.entidade_id = f.id
      LEFT JOIN veiculos v ON d.entidade_tipo = 'veiculo' AND d.entidade_id = v.id
      ${whereClause}
      ORDER BY d.created_at DESC
    `).all(...params);
  }

  static findById(id) {
    return db.prepare(`
      SELECT d.*,
        CASE WHEN d.entidade_tipo = 'funcionario' THEN f.nome
             WHEN d.entidade_tipo = 'veiculo' THEN (v.marca || ' ' || v.modelo || ' - ' || v.placa)
             ELSE NULL END as entidade_nome
      FROM documentos d
      LEFT JOIN funcionarios f ON d.entidade_tipo = 'funcionario' AND d.entidade_id = f.id
      LEFT JOIN veiculos v ON d.entidade_tipo = 'veiculo' AND d.entidade_id = v.id
      WHERE d.id = ?
    `).get(id);
  }

  static getByEntity(entidadeTipo, entidadeId) {
    return db.prepare(`
      SELECT * FROM documentos
      WHERE entidade_tipo = ? AND entidade_id = ?
      ORDER BY created_at DESC
    `).all(entidadeTipo, entidadeId);
  }

  static create(data) {
    const result = db.prepare(`
      INSERT INTO documentos (tipo, descricao, entidade_tipo, entidade_id, arquivo_path, arquivo_original, dados_extraidos, enviado_por_whatsapp, whatsapp_mensagem_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.tipo, data.descricao || null, data.entidade_tipo, data.entidade_id,
      data.arquivo_path, data.arquivo_original || null,
      data.dados_extraidos ? JSON.stringify(data.dados_extraidos) : null,
      data.enviado_por_whatsapp ? 1 : 0, data.whatsapp_mensagem_id || null
    );
    return result.lastInsertRowid;
  }

  static delete(id) {
    return db.prepare('DELETE FROM documentos WHERE id = ?').run(id);
  }

  static getTypes() {
    return ['crlv', 'rg', 'cpf', 'cnh', 'comprovante_endereco', 'apolice_seguro', 'contrato', 'holerite', 'outro'];
  }

  static getTypeLabel(tipo) {
    const labels = {
      crlv: 'CRLV', rg: 'RG', cpf: 'CPF', cnh: 'CNH',
      comprovante_endereco: 'Comprovante de Endereço',
      apolice_seguro: 'Apólice de Seguro', contrato: 'Contrato',
      holerite: 'Holerite', outro: 'Outro'
    };
    return labels[tipo] || tipo;
  }
}

module.exports = Documento;
