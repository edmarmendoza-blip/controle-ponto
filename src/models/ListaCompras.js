const { db } = require('../config/database');

class ListaCompras {
  // --- Normalização de nome ---
  static normalizeName(name) {
    return (name || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  // --- Listas ---
  static getAllListas(includeCompleted = false) {
    const where = includeCompleted ? '' : "WHERE l.status != 'concluida'";
    return db.prepare(`
      SELECT l.*,
        COUNT(i.id) as total_itens,
        SUM(CASE WHEN i.comprado = 1 THEN 1 ELSE 0 END) as itens_comprados,
        SUM(CASE WHEN i.comprado = 1 THEN COALESCE(i.preco_pago, 0) ELSE 0 END) as total_gasto
      FROM listas_compras l
      LEFT JOIN lista_compras_itens i ON i.lista_id = l.id
      ${where}
      GROUP BY l.id
      ORDER BY l.created_at DESC
    `).all();
  }

  static findListaById(id) {
    const lista = db.prepare(`
      SELECT l.*,
        COUNT(i.id) as total_itens,
        SUM(CASE WHEN i.comprado = 1 THEN 1 ELSE 0 END) as itens_comprados,
        SUM(CASE WHEN i.comprado = 1 THEN COALESCE(i.preco_pago, 0) ELSE 0 END) as total_gasto
      FROM listas_compras l
      LEFT JOIN lista_compras_itens i ON i.lista_id = l.id
      WHERE l.id = ?
      GROUP BY l.id
    `).get(id);
    return lista || null;
  }

  static createLista(data) {
    const result = db.prepare(
      `INSERT INTO listas_compras (nome, categoria, criado_por, observacoes)
       VALUES (?, ?, ?, ?)`
    ).run(
      data.nome,
      data.categoria || 'mercado',
      data.criado_por || null,
      data.observacoes || null
    );
    return result.lastInsertRowid;
  }

  static updateLista(id, data) {
    const fields = [];
    const values = [];
    const allowed = ['nome', 'categoria', 'status', 'observacoes'];
    for (const [key, value] of Object.entries(data)) {
      if (allowed.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value === '' ? null : value);
      }
    }
    if (fields.length === 0) return null;
    fields.push("updated_at = datetime('now','localtime')");
    values.push(id);
    return db.prepare(`UPDATE listas_compras SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  static deleteLista(id) {
    // Cascades to lista_compras_itens via ON DELETE CASCADE
    return db.prepare('DELETE FROM listas_compras WHERE id = ?').run(id);
  }

  // --- Itens ---
  static getItens(listaId) {
    return db.prepare(`
      SELECT * FROM lista_compras_itens
      WHERE lista_id = ?
      ORDER BY comprado ASC, created_at ASC
    `).all(listaId);
  }

  static addItem(listaId, data) {
    const result = db.prepare(
      `INSERT INTO lista_compras_itens (lista_id, nome_item, quantidade, unidade, categoria_item, observacao)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      listaId,
      data.nome_item,
      data.quantidade || 1,
      data.unidade || 'un',
      data.categoria_item || 'outro',
      data.observacao || null
    );
    return result.lastInsertRowid;
  }

  static updateItem(itemId, data) {
    const fields = [];
    const values = [];
    const allowed = ['nome_item', 'quantidade', 'unidade', 'categoria_item', 'observacao', 'comprado', 'preco_pago', 'estabelecimento', 'data_compra', 'nota_fiscal_path'];
    for (const [key, value] of Object.entries(data)) {
      if (allowed.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value === '' ? null : value);
      }
    }
    if (fields.length === 0) return null;
    values.push(itemId);
    return db.prepare(`UPDATE lista_compras_itens SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  static deleteItem(itemId) {
    return db.prepare('DELETE FROM lista_compras_itens WHERE id = ?').run(itemId);
  }

  static markAsBought(itemId, data) {
    const { preco_pago, estabelecimento, data_compra, nota_fiscal_path } = data;

    // Fetch item to get nome and categoria for historico
    const item = db.prepare('SELECT * FROM lista_compras_itens WHERE id = ?').get(itemId);
    if (!item) return null;

    // Update item as bought
    db.prepare(`
      UPDATE lista_compras_itens
      SET comprado = 1,
          preco_pago = ?,
          estabelecimento = ?,
          data_compra = ?,
          nota_fiscal_path = ?
      WHERE id = ?
    `).run(
      preco_pago || null,
      estabelecimento || null,
      data_compra || null,
      nota_fiscal_path || null,
      itemId
    );

    // Insert into historico_precos if price was provided
    if (preco_pago && parseFloat(preco_pago) > 0) {
      ListaCompras.addPreco({
        nome_item: item.nome_item,
        preco: parseFloat(preco_pago),
        estabelecimento: estabelecimento || null,
        categoria: item.categoria_item || null,
        fonte: 'manual',
        nota_fiscal_path: nota_fiscal_path || null,
        data_compra: data_compra || null
      });
    }

    return db.prepare('SELECT * FROM lista_compras_itens WHERE id = ?').get(itemId);
  }

  // --- Historico de Precos ---
  static addPreco(data) {
    const nomeNormalizado = ListaCompras.normalizeName(data.nome_item);
    const result = db.prepare(
      `INSERT INTO historico_precos (nome_item, nome_normalizado, preco, estabelecimento, categoria, fonte, nota_fiscal_path, data_compra)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.nome_item,
      nomeNormalizado,
      data.preco,
      data.estabelecimento || null,
      data.categoria || null,
      data.fonte || 'manual',
      data.nota_fiscal_path || null,
      data.data_compra || null
    );
    return result.lastInsertRowid;
  }

  static searchPrecos(query) {
    const normalized = ListaCompras.normalizeName(query);
    return db.prepare(`
      SELECT nome_item, nome_normalizado,
        AVG(preco) as preco_medio,
        MIN(preco) as preco_minimo,
        MAX(preco) as preco_maximo,
        COUNT(*) as total_registros,
        MAX(data_compra) as ultima_compra,
        MAX(estabelecimento) as ultimo_estabelecimento
      FROM historico_precos
      WHERE nome_normalizado LIKE ?
      GROUP BY nome_normalizado
      ORDER BY nome_normalizado
      LIMIT 20
    `).all(`%${normalized}%`);
  }

  static getPrecoHistory(nomeNormalizado) {
    return db.prepare(`
      SELECT * FROM historico_precos
      WHERE nome_normalizado = ?
      ORDER BY data_compra DESC, created_at DESC
    `).all(nomeNormalizado);
  }

  static getComparativo(mes, ano) {
    // Pad month to two digits
    const mesStr = String(mes).padStart(2, '0');
    const prefix = `${ano}-${mesStr}`;

    // Fetch all purchases in the given month
    const compras = db.prepare(`
      SELECT nome_normalizado, nome_item, preco, estabelecimento, data_compra
      FROM historico_precos
      WHERE data_compra LIKE ?
    `).all(`${prefix}%`);

    if (compras.length === 0) {
      return { mes, ano, economia_total: 0, itens: [] };
    }

    // For each purchase, find highest price ever paid for that item
    let economiaTotal = 0;
    const itens = compras.map(compra => {
      const maxRow = db.prepare(`
        SELECT MAX(preco) as preco_maximo
        FROM historico_precos
        WHERE nome_normalizado = ?
      `).get(compra.nome_normalizado);

      const precoMaximo = maxRow ? maxRow.preco_maximo : compra.preco;
      const economia = Math.max(0, precoMaximo - compra.preco);
      economiaTotal += economia;

      return {
        nome_item: compra.nome_item,
        nome_normalizado: compra.nome_normalizado,
        preco_pago: compra.preco,
        preco_maximo_historico: precoMaximo,
        economia: economia,
        estabelecimento: compra.estabelecimento,
        data_compra: compra.data_compra
      };
    });

    return {
      mes,
      ano,
      economia_total: economiaTotal,
      total_itens: itens.length,
      itens
    };
  }
}

module.exports = ListaCompras;
