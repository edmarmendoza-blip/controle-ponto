const { db } = require('../config/database');

class Estoque {
  // --- Items ---
  static getAllItems(includeInactive = false) {
    const where = includeInactive ? '' : 'WHERE ativo = 1';
    return db.prepare(`SELECT * FROM estoque_itens ${where} ORDER BY categoria, nome`).all();
  }

  static findItemById(id) {
    return db.prepare('SELECT * FROM estoque_itens WHERE id = ?').get(id);
  }

  static createItem(data) {
    const result = db.prepare(
      `INSERT INTO estoque_itens (nome, categoria, unidade, quantidade_atual, quantidade_minima, localizacao)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      data.nome,
      data.categoria || 'outros',
      data.unidade || 'un',
      data.quantidade_atual || 0,
      data.quantidade_minima || 0,
      data.localizacao || null
    );
    return result.lastInsertRowid;
  }

  static updateItem(id, data) {
    const fields = [];
    const values = [];
    const allowed = ['nome', 'categoria', 'unidade', 'quantidade_atual', 'quantidade_minima', 'localizacao', 'ativo'];
    for (const [key, value] of Object.entries(data)) {
      if (allowed.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value === '' ? null : value);
      }
    }
    if (fields.length === 0) return null;
    values.push(id);
    return db.prepare(`UPDATE estoque_itens SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  static deleteItem(id) {
    return db.prepare('UPDATE estoque_itens SET ativo = 0 WHERE id = ?').run(id);
  }

  // --- Movimentacoes ---
  static getMovimentacoes(itemId, limit = 50) {
    return db.prepare(
      `SELECT m.*, u.name as registrado_por_nome
       FROM estoque_movimentacoes m
       LEFT JOIN users u ON m.registrado_por = u.id
       WHERE m.item_id = ?
       ORDER BY m.created_at DESC
       LIMIT ?`
    ).all(itemId, limit);
  }

  static getAllMovimentacoes(limit = 100) {
    return db.prepare(
      `SELECT m.*, i.nome as item_nome, i.unidade, u.name as registrado_por_nome
       FROM estoque_movimentacoes m
       LEFT JOIN estoque_itens i ON m.item_id = i.id
       LEFT JOIN users u ON m.registrado_por = u.id
       ORDER BY m.created_at DESC
       LIMIT ?`
    ).all(limit);
  }

  static registrarMovimentacao(data) {
    const result = db.prepare(
      `INSERT INTO estoque_movimentacoes (item_id, tipo, quantidade, observacao, registrado_por, fonte)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      data.item_id,
      data.tipo, // 'entrada', 'saida', 'ajuste', 'compra'
      data.quantidade,
      data.observacao || null,
      data.registrado_por || null,
      data.fonte || 'manual'
    );

    // Update item quantity
    if (data.tipo === 'entrada' || data.tipo === 'compra') {
      db.prepare('UPDATE estoque_itens SET quantidade_atual = quantidade_atual + ? WHERE id = ?').run(data.quantidade, data.item_id);
    } else if (data.tipo === 'saida') {
      db.prepare('UPDATE estoque_itens SET quantidade_atual = MAX(0, quantidade_atual - ?) WHERE id = ?').run(data.quantidade, data.item_id);
    } else if (data.tipo === 'ajuste') {
      db.prepare('UPDATE estoque_itens SET quantidade_atual = ? WHERE id = ?').run(data.quantidade, data.item_id);
    }

    return result.lastInsertRowid;
  }

  // --- Alerts ---
  static getAlertasEstoqueBaixo() {
    return db.prepare(
      `SELECT * FROM estoque_itens
       WHERE ativo = 1 AND quantidade_minima > 0 AND quantidade_atual <= quantidade_minima
       ORDER BY nome`
    ).all();
  }

  // --- Categorias ---
  static getCategorias() {
    return db.prepare('SELECT DISTINCT categoria FROM estoque_itens WHERE ativo = 1 ORDER BY categoria').all()
      .map(r => r.categoria);
  }
}

module.exports = Estoque;
