const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const Tarefa = require('../models/Tarefa');
const { authenticateToken, requireGestor } = require('../middleware/auth');
const AuditLog = require('../services/auditLog');

const router = express.Router();

// Middleware: check if user can create tasks
function canCreateTasks(req, res, next) {
  if (req.user.role === 'admin' || req.user.role === 'gestor') return next();
  if (req.user.pode_criar_tarefas) return next();
  return res.status(403).json({ error: 'Sem permissão para criar tarefas' });
}

// GET /api/tarefas
router.get('/', authenticateToken, (req, res) => {
  try {
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.prioridade) filters.prioridade = req.query.prioridade;
    if (req.query.funcionarioId) filters.funcionarioId = parseInt(req.query.funcionarioId);
    const tarefas = Tarefa.getAll(filters);
    res.json(tarefas);
  } catch (err) {
    console.error('[Tarefas] List error:', err.message);
    res.status(500).json({ error: 'Erro ao listar tarefas' });
  }
});

// GET /api/tarefas/:id
router.get('/:id', authenticateToken, [
  param('id').isInt()
], (req, res) => {
  try {
    const tarefa = Tarefa.findById(req.params.id);
    if (!tarefa) return res.status(404).json({ error: 'Tarefa não encontrada' });
    res.json(tarefa);
  } catch (err) {
    console.error('[Tarefas] Get error:', err.message);
    res.status(500).json({ error: 'Erro ao buscar tarefa' });
  }
});

// POST /api/tarefas
router.post('/', authenticateToken, canCreateTasks, [
  body('titulo').notEmpty().trim().withMessage('Título obrigatório'),
  body('prioridade').optional().isIn(['alta', 'media', 'baixa']),
  body('funcionario_ids').optional().isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const data = {
      titulo: req.body.titulo,
      descricao: req.body.descricao || null,
      prioridade: req.body.prioridade || 'media',
      prazo: req.body.prazo || null,
      criado_por: req.user.id,
      fonte: req.body.fonte || 'web',
      funcionario_ids: req.body.funcionario_ids || []
    };

    const id = Tarefa.create(data);
    AuditLog.log(req.user.id, 'create', 'tarefa', id, { titulo: data.titulo }, req.ip);

    // Send WhatsApp notification to assigned employees
    if (data.funcionario_ids.length > 0) {
      try {
        const whatsappService = require('../services/whatsapp');
        const Funcionario = require('../models/Funcionario');
        for (const fid of data.funcionario_ids) {
          const func = Funcionario.findById(fid);
          if (func && func.telefone && whatsappService.ready) {
            const prazoText = data.prazo ? ` - Prazo: ${data.prazo.split('-').reverse().join('/')}` : '';
            const chatId = func.telefone.replace(/\D/g, '') + '@c.us';
            whatsappService.client.sendMessage(chatId, `📋 Nova tarefa: ${data.titulo}${prazoText}`).catch(e => {
              console.error(`[Tarefas] WhatsApp notify error for ${func.nome}:`, e.message);
            });
          }
        }
      } catch (e) {
        console.error('[Tarefas] WhatsApp notification error:', e.message);
      }
    }

    res.status(201).json({ id, message: 'Tarefa criada com sucesso' });
  } catch (err) {
    console.error('[Tarefas] Create error:', err.message);
    res.status(500).json({ error: 'Erro ao criar tarefa' });
  }
});

// PUT /api/tarefas/:id
router.put('/:id', authenticateToken, canCreateTasks, [
  param('id').isInt(),
  body('titulo').optional().notEmpty().trim(),
  body('prioridade').optional().isIn(['alta', 'media', 'baixa']),
  body('status').optional().isIn(['pendente', 'em_andamento', 'concluida', 'cancelada'])
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const tarefa = Tarefa.findById(req.params.id);
    if (!tarefa) return res.status(404).json({ error: 'Tarefa não encontrada' });

    Tarefa.update(req.params.id, req.body);
    AuditLog.log(req.user.id, 'update', 'tarefa', parseInt(req.params.id), req.body, req.ip);
    res.json({ message: 'Tarefa atualizada com sucesso' });
  } catch (err) {
    console.error('[Tarefas] Update error:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar tarefa' });
  }
});

// DELETE /api/tarefas/:id
router.delete('/:id', authenticateToken, canCreateTasks, [
  param('id').isInt()
], (req, res) => {
  try {
    const tarefa = Tarefa.findById(req.params.id);
    if (!tarefa) return res.status(404).json({ error: 'Tarefa não encontrada' });

    Tarefa.delete(req.params.id);
    AuditLog.log(req.user.id, 'delete', 'tarefa', parseInt(req.params.id), { titulo: tarefa.titulo }, req.ip);
    res.json({ message: 'Tarefa excluída com sucesso' });
  } catch (err) {
    console.error('[Tarefas] Delete error:', err.message);
    res.status(500).json({ error: 'Erro ao excluir tarefa' });
  }
});

// PUT /api/tarefas/:id/funcionario/:funcId/status
router.put('/:id/funcionario/:funcId/status', authenticateToken, [
  param('id').isInt(),
  param('funcId').isInt(),
  body('status').isIn(['pendente', 'em_andamento', 'concluida'])
], (req, res) => {
  try {
    Tarefa.updateFuncionarioStatus(req.params.id, req.params.funcId, req.body.status);
    res.json({ message: 'Status atualizado' });
  } catch (err) {
    console.error('[Tarefas] Status update error:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar status' });
  }
});

module.exports = router;
