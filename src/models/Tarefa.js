const { db } = require('../config/database');

class Tarefa {
  static getAll(filters = {}) {
    let where = [];
    let params = [];

    if (filters.status) {
      where.push('t.status = ?');
      params.push(filters.status);
    }
    if (filters.prioridade) {
      where.push('t.prioridade = ?');
      params.push(filters.prioridade);
    }
    if (filters.funcionarioId) {
      where.push('EXISTS (SELECT 1 FROM tarefa_funcionarios tf WHERE tf.tarefa_id = t.id AND tf.funcionario_id = ?)');
      params.push(filters.funcionarioId);
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    const tarefas = db.prepare(`
      SELECT t.*, u.name as criado_por_nome
      FROM tarefas t
      LEFT JOIN users u ON t.criado_por = u.id
      ${whereClause}
      ORDER BY
        CASE t.prioridade WHEN 'alta' THEN 1 WHEN 'media' THEN 2 WHEN 'baixa' THEN 3 END,
        t.prazo ASC NULLS LAST,
        t.created_at DESC
    `).all(...params);

    // Attach assigned funcionarios
    for (const tarefa of tarefas) {
      tarefa.funcionarios = db.prepare(`
        SELECT tf.*, f.nome as funcionario_nome
        FROM tarefa_funcionarios tf
        JOIN funcionarios f ON tf.funcionario_id = f.id
        WHERE tf.tarefa_id = ?
      `).all(tarefa.id);
    }

    return tarefas;
  }

  static findById(id) {
    const tarefa = db.prepare(`
      SELECT t.*, u.name as criado_por_nome
      FROM tarefas t
      LEFT JOIN users u ON t.criado_por = u.id
      WHERE t.id = ?
    `).get(id);

    if (tarefa) {
      tarefa.funcionarios = db.prepare(`
        SELECT tf.*, f.nome as funcionario_nome
        FROM tarefa_funcionarios tf
        JOIN funcionarios f ON tf.funcionario_id = f.id
        WHERE tf.tarefa_id = ?
      `).all(tarefa.id);
    }

    return tarefa;
  }

  static create(data) {
    const result = db.prepare(`
      INSERT INTO tarefas (titulo, descricao, prioridade, prazo, criado_por, fonte)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      data.titulo,
      data.descricao || null,
      data.prioridade || 'media',
      data.prazo || null,
      data.criado_por || null,
      data.fonte || 'web'
    );

    const tarefaId = result.lastInsertRowid;

    // Assign funcionarios
    if (data.funcionario_ids && Array.isArray(data.funcionario_ids)) {
      const insertAssign = db.prepare(
        'INSERT INTO tarefa_funcionarios (tarefa_id, funcionario_id) VALUES (?, ?)'
      );
      for (const fid of data.funcionario_ids) {
        insertAssign.run(tarefaId, fid);
      }
    }

    return tarefaId;
  }

  static update(id, data) {
    const fields = [];
    const values = [];
    const allowed = ['titulo', 'descricao', 'prioridade', 'prazo', 'status'];

    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(data[key]);
      }
    }

    if (fields.length > 0) {
      fields.push("updated_at = datetime('now','localtime')");
      values.push(id);
      db.prepare(`UPDATE tarefas SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    // Update funcionarios if provided
    if (data.funcionario_ids && Array.isArray(data.funcionario_ids)) {
      db.prepare('DELETE FROM tarefa_funcionarios WHERE tarefa_id = ?').run(id);
      const insertAssign = db.prepare(
        'INSERT INTO tarefa_funcionarios (tarefa_id, funcionario_id) VALUES (?, ?)'
      );
      for (const fid of data.funcionario_ids) {
        insertAssign.run(id, fid);
      }
    }

    return { changes: fields.length };
  }

  static delete(id) {
    db.prepare('DELETE FROM tarefa_funcionarios WHERE tarefa_id = ?').run(id);
    return db.prepare('DELETE FROM tarefas WHERE id = ?').run(id);
  }

  static updateFuncionarioStatus(tarefaId, funcionarioId, status) {
    const concluida = status === 'concluida' ? "datetime('now','localtime')" : 'NULL';
    db.prepare(`
      UPDATE tarefa_funcionarios
      SET status = ?, concluida_em = ${concluida}
      WHERE tarefa_id = ? AND funcionario_id = ?
    `).run(status, tarefaId, funcionarioId);

    // If all funcionarios are done, mark tarefa as concluida
    const remaining = db.prepare(`
      SELECT COUNT(*) as count FROM tarefa_funcionarios
      WHERE tarefa_id = ? AND status != 'concluida'
    `).get(tarefaId);
    if (remaining.count === 0) {
      db.prepare("UPDATE tarefas SET status = 'concluida', updated_at = datetime('now','localtime') WHERE id = ?").run(tarefaId);
    }
  }
}

module.exports = Tarefa;
