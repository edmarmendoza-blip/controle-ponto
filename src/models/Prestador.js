const { db } = require('../config/database');

class Prestador {
  static getAll(includeInactive = false) {
    const where = includeInactive ? '' : "WHERE p.status = 'ativo'";
    return db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM prestador_visitas WHERE prestador_id = p.id) as total_visitas,
        (SELECT MAX(data_entrada) FROM prestador_visitas WHERE prestador_id = p.id) as ultima_visita
      FROM prestadores p ${where} ORDER BY p.nome
    `).all();
  }

  static findById(id) {
    return db.prepare('SELECT * FROM prestadores WHERE id = ?').get(id);
  }

  static create(data) {
    const allFields = ['nome', 'telefone', 'email', 'empresa', 'cnpj', 'cpf', 'tipo', 'frequencia_tipo', 'frequencia_vezes', 'frequencia_dias', 'servico_descricao', 'valor_visita', 'valor_mensal', 'pix_chave', 'pix_tipo', 'banco', 'agencia', 'conta', 'observacoes', 'status'];
    const fields = allFields.filter(f => data[f] !== undefined && data[f] !== null);
    const values = fields.map(f => data[f]);
    const placeholders = fields.map(() => '?').join(', ');
    const result = db.prepare(`INSERT INTO prestadores (${fields.join(', ')}) VALUES (${placeholders})`).run(...values);
    return result.lastInsertRowid;
  }

  static update(id, data) {
    const fields = ['nome', 'telefone', 'email', 'empresa', 'cnpj', 'cpf', 'tipo', 'frequencia_tipo', 'frequencia_vezes', 'frequencia_dias', 'servico_descricao', 'valor_visita', 'valor_mensal', 'pix_chave', 'pix_tipo', 'banco', 'agencia', 'conta', 'observacoes', 'status'];
    const sets = [];
    const values = [];
    for (const f of fields) {
      if (data[f] !== undefined) {
        sets.push(`${f} = ?`);
        values.push(data[f]);
      }
    }
    if (sets.length === 0) return;
    sets.push("updated_at = datetime('now','localtime')");
    values.push(id);
    db.prepare(`UPDATE prestadores SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  static delete(id) {
    db.prepare("UPDATE prestadores SET status = 'inativo', updated_at = datetime('now','localtime') WHERE id = ?").run(id);
  }

  // Find prestador by phone number (for WhatsApp matching)
  static findByPhone(phone) {
    const cleanPhone = phone.replace(/\D/g, '');
    return db.prepare("SELECT * FROM prestadores WHERE status = 'ativo' AND telefone IS NOT NULL AND REPLACE(REPLACE(REPLACE(telefone, '(', ''), ')', ''), '-', '') LIKE '%' || ? || '%'").get(cleanPhone.slice(-8));
  }

  // --- Visitas ---
  static getVisitas(prestadorId, limit = 50) {
    return db.prepare('SELECT * FROM prestador_visitas WHERE prestador_id = ? ORDER BY data_entrada DESC LIMIT ?').all(prestadorId, limit);
  }

  static createVisita(data) {
    const result = db.prepare(`INSERT INTO prestador_visitas (prestador_id, data_entrada, data_saida, servico_realizado, valor_cobrado, avaliacao, observacao, fonte) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      data.prestador_id, data.data_entrada || null, data.data_saida || null,
      data.servico_realizado || null, data.valor_cobrado || null,
      data.avaliacao || null, data.observacao || null, data.fonte || 'manual'
    );
    return result.lastInsertRowid;
  }

  static updateVisita(id, data) {
    const fields = ['data_entrada', 'data_saida', 'servico_realizado', 'valor_cobrado', 'avaliacao', 'observacao'];
    const sets = [];
    const values = [];
    for (const f of fields) {
      if (data[f] !== undefined) {
        sets.push(`${f} = ?`);
        values.push(data[f]);
      }
    }
    if (sets.length === 0) return;
    values.push(id);
    db.prepare(`UPDATE prestador_visitas SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  // Get today's visita for a prestador
  static getTodayVisita(prestadorId, date) {
    const today = date || new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    return db.prepare("SELECT * FROM prestador_visitas WHERE prestador_id = ? AND data_entrada LIKE ? ORDER BY id DESC LIMIT 1").get(prestadorId, today + '%');
  }

  // --- Pagamentos ---
  static getPagamentos(prestadorId, limit = 50) {
    return db.prepare('SELECT * FROM prestador_pagamentos WHERE prestador_id = ? ORDER BY data_pagamento DESC LIMIT ?').all(prestadorId, limit);
  }

  static createPagamento(data) {
    const result = db.prepare(`INSERT INTO prestador_pagamentos (prestador_id, visita_id, valor, data_pagamento, metodo, comprovante_path, status, observacao) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      data.prestador_id, data.visita_id || null, data.valor,
      data.data_pagamento || new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }),
      data.metodo || 'pix', data.comprovante_path || null,
      data.status || 'pendente', data.observacao || null
    );
    return result.lastInsertRowid;
  }

  // Get expected prestadores for a given day of week
  static getExpectedToday() {
    const dayNames = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
    const todayDay = dayNames[new Date().getDay()];
    const all = db.prepare("SELECT * FROM prestadores WHERE tipo = 'fixo' AND status = 'ativo' AND frequencia_dias IS NOT NULL").all();
    return all.filter(p => {
      try {
        const dias = JSON.parse(p.frequencia_dias);
        return Array.isArray(dias) && dias.includes(todayDay);
      } catch { return false; }
    });
  }
}

module.exports = Prestador;
