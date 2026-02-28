const { db } = require('../config/database');

class Despesa {
  static getAll(filters = {}) {
    const { status, funcionario_id, categoria, data_inicio, data_fim, page = 1, limit = 50 } = filters;

    let where = 'WHERE 1=1';
    const params = [];

    if (status) {
      where += ' AND d.status = ?';
      params.push(status);
    }
    if (funcionario_id) {
      where += ' AND d.funcionario_id = ?';
      params.push(funcionario_id);
    }
    if (categoria) {
      where += ' AND d.categoria = ?';
      params.push(categoria);
    }
    if (data_inicio) {
      where += ' AND d.data_despesa >= ?';
      params.push(data_inicio);
    }
    if (data_fim) {
      where += ' AND d.data_despesa <= ?';
      params.push(data_fim);
    }

    const countQuery = `SELECT COUNT(*) as total FROM despesas d ${where}`;
    const total = db.prepare(countQuery).get(...params).total;

    const offset = (page - 1) * limit;
    const query = `
      SELECT d.*, f.nome as funcionario_nome
      FROM despesas d
      LEFT JOIN funcionarios f ON d.funcionario_id = f.id
      ${where}
      ORDER BY d.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const data = db.prepare(query).all(...params, limit, offset);

    return {
      data,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / limit)
    };
  }

  static findById(id) {
    return db.prepare(`
      SELECT d.*, f.nome as funcionario_nome
      FROM despesas d
      LEFT JOIN funcionarios f ON d.funcionario_id = f.id
      WHERE d.id = ?
    `).get(id);
  }

  static create(data) {
    const result = db.prepare(`
      INSERT INTO despesas
        (funcionario_id, descricao, valor, categoria, estabelecimento, data_despesa,
         comprovante_path, dados_extraidos, fonte, fonte_chat, observacao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.funcionario_id || null,
      data.descricao || null,
      data.valor || 0,
      data.categoria || 'outros',
      data.estabelecimento || null,
      data.data_despesa || null,
      data.comprovante_path || null,
      data.dados_extraidos ? JSON.stringify(data.dados_extraidos) : null,
      data.fonte || 'manual',
      data.fonte_chat || null,
      data.observacao || null
    );
    return result.lastInsertRowid;
  }

  static update(id, data) {
    const allowed = [
      'funcionario_id', 'descricao', 'valor', 'categoria', 'estabelecimento',
      'data_despesa', 'comprovante_path', 'dados_extraidos', 'observacao'
    ];
    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(data)) {
      if (allowed.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value === '' ? null : value);
      }
    }

    if (fields.length === 0) return null;

    fields.push("updated_at = datetime('now','localtime')");
    values.push(id);

    return db.prepare(`UPDATE despesas SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  static approve(id, aprovadoPor) {
    return db.prepare(`
      UPDATE despesas
      SET status = 'aprovado',
          aprovado_por = ?,
          data_aprovacao = datetime('now','localtime'),
          updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(aprovadoPor, id);
  }

  static reject(id, aprovadoPor, observacao) {
    return db.prepare(`
      UPDATE despesas
      SET status = 'rejeitado',
          aprovado_por = ?,
          data_aprovacao = datetime('now','localtime'),
          observacao = ?,
          updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(aprovadoPor, observacao || null, id);
  }

  static markReimbursed(id) {
    return db.prepare(`
      UPDATE despesas
      SET status = 'reembolsado',
          data_reembolso = datetime('now','localtime'),
          updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(id);
  }

  static delete(id) {
    return db.prepare('DELETE FROM despesas WHERE id = ?').run(id);
  }

  static getRelatorio(mes, ano) {
    let where = 'WHERE 1=1';
    const params = [];

    if (mes && ano) {
      where += ` AND strftime('%m', data_despesa) = ? AND strftime('%Y', data_despesa) = ?`;
      params.push(String(mes).padStart(2, '0'), String(ano));
    } else if (ano) {
      where += ` AND strftime('%Y', data_despesa) = ?`;
      params.push(String(ano));
    }

    const totais = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'pendente' THEN valor ELSE 0 END) as totalPendente,
        SUM(CASE WHEN status = 'aprovado' THEN valor ELSE 0 END) as totalAprovado,
        SUM(CASE WHEN status = 'reembolsado' THEN valor ELSE 0 END) as totalReembolsado,
        SUM(CASE WHEN status = 'rejeitado' THEN valor ELSE 0 END) as totalRejeitado
      FROM despesas
      ${where}
    `).get(...params);

    const porCategoria = db.prepare(`
      SELECT categoria, SUM(valor) as total, COUNT(*) as count
      FROM despesas
      ${where}
      GROUP BY categoria
      ORDER BY total DESC
    `).all(...params);

    const porFuncionario = db.prepare(`
      SELECT f.nome, SUM(d.valor) as total, COUNT(*) as count
      FROM despesas d
      LEFT JOIN funcionarios f ON d.funcionario_id = f.id
      ${where}
      GROUP BY d.funcionario_id
      ORDER BY total DESC
    `).all(...params);

    const evolucaoMensal = db.prepare(`
      SELECT strftime('%Y-%m', data_despesa) as mes, SUM(valor) as total
      FROM despesas
      WHERE data_despesa IS NOT NULL
      GROUP BY strftime('%Y-%m', data_despesa)
      ORDER BY mes DESC
      LIMIT 12
    `).all();

    return {
      totalPendente: totais.totalPendente || 0,
      totalAprovado: totais.totalAprovado || 0,
      totalReembolsado: totais.totalReembolsado || 0,
      totalRejeitado: totais.totalRejeitado || 0,
      porCategoria,
      porFuncionario,
      evolucaoMensal
    };
  }
}

module.exports = Despesa;
