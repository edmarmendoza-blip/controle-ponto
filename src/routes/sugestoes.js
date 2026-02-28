const express = require('express');
const { param, query, validationResult } = require('express-validator');
const { authenticateToken, requireGestor } = require('../middleware/auth');
const { db } = require('../config/database');
const AuditLog = require('../services/auditLog');

const router = express.Router();

// GET /api/sugestoes - list suggestions with filters
router.get('/', authenticateToken, (req, res) => {
  try {
    const { status, categoria, dataInicio, dataFim } = req.query;
    let query_sql = 'SELECT * FROM sugestoes_melhoria WHERE 1=1';
    const params = [];

    if (status) {
      query_sql += ' AND status = ?';
      params.push(status);
    }
    if (categoria) {
      query_sql += ' AND categoria = ?';
      params.push(categoria);
    }
    if (dataInicio) {
      query_sql += ' AND date(created_at) >= ?';
      params.push(dataInicio);
    }
    if (dataFim) {
      query_sql += ' AND date(created_at) <= ?';
      params.push(dataFim);
    }

    query_sql += ' ORDER BY created_at DESC';
    const sugestoes = db.prepare(query_sql).all(...params);
    res.json({ success: true, data: sugestoes });
  } catch (err) {
    console.error('[Sugestoes] List error:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao listar sugestões' });
  }
});

// PUT /api/sugestoes/:id - update suggestion
router.put('/:id', authenticateToken, requireGestor, [
  param('id').isInt()
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const existing = db.prepare('SELECT id FROM sugestoes_melhoria WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Sugestão não encontrada' });

    const allowed = ['titulo', 'descricao', 'prioridade', 'categoria', 'status'];
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(req.body)) {
      if (allowed.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

    fields.push("updated_at = datetime('now','localtime')");
    values.push(req.params.id);
    db.prepare(`UPDATE sugestoes_melhoria SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    AuditLog.log(req.user.id, 'update', 'sugestao', parseInt(req.params.id), req.body, req.ip);
    res.json({ success: true, message: 'Sugestão atualizada' });
  } catch (err) {
    console.error('[Sugestoes] Update error:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao atualizar sugestão' });
  }
});

// POST /api/sugestoes/:id/converter-tarefa - convert to task
router.post('/:id/converter-tarefa', authenticateToken, requireGestor, [
  param('id').isInt()
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const sugestao = db.prepare('SELECT * FROM sugestoes_melhoria WHERE id = ?').get(req.params.id);
    if (!sugestao) return res.status(404).json({ error: 'Sugestão não encontrada' });
    if (sugestao.status === 'convertida') return res.status(400).json({ error: 'Sugestão já foi convertida em tarefa' });

    // Map priority
    const prioridadeMap = { alta: 'alta', media: 'media', baixa: 'baixa' };
    const prioridade = prioridadeMap[sugestao.prioridade] || 'media';

    // Create task
    const result = db.prepare(`
      INSERT INTO tarefas (titulo, descricao, prioridade, criado_por, status, fonte, created_at)
      VALUES (?, ?, ?, ?, 'pendente', 'whatsapp', datetime('now','localtime'))
    `).run(sugestao.titulo, sugestao.descricao || '', prioridade, req.user.id);

    const tarefaId = result.lastInsertRowid;

    // Update suggestion
    db.prepare(`
      UPDATE sugestoes_melhoria SET status = 'convertida', convertida_tarefa_id = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(tarefaId, req.params.id);

    AuditLog.log(req.user.id, 'converter_sugestao', 'sugestao', parseInt(req.params.id), { tarefa_id: tarefaId }, req.ip);
    res.json({ success: true, tarefa_id: tarefaId, message: `Tarefa #${tarefaId} criada a partir da sugestão` });
  } catch (err) {
    console.error('[Sugestoes] Convert error:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao converter sugestão em tarefa' });
  }
});

// DELETE /api/sugestoes/:id
router.delete('/:id', authenticateToken, requireGestor, [
  param('id').isInt()
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const existing = db.prepare('SELECT id FROM sugestoes_melhoria WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Sugestão não encontrada' });

    db.prepare('DELETE FROM sugestoes_melhoria WHERE id = ?').run(req.params.id);
    AuditLog.log(req.user.id, 'delete', 'sugestao', parseInt(req.params.id), null, req.ip);
    res.json({ success: true, message: 'Sugestão excluída' });
  } catch (err) {
    console.error('[Sugestoes] Delete error:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao excluir sugestão' });
  }
});

module.exports = router;
