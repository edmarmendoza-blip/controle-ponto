const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const Funcionario = require('../models/Funcionario');
const { authenticateToken, requireAdmin, requireGestor } = require('../middleware/auth');
const AuditLog = require('../services/auditLog');

const router = express.Router();

// GET /api/funcionarios
router.get('/', authenticateToken, (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const funcionarios = Funcionario.getAll(includeInactive);
    res.json(funcionarios);
  } catch (err) {
    console.error('List funcionarios error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/funcionarios/parse-jornada - AI-powered schedule parsing
// MUST be before /:id to avoid being caught by the param route
router.post('/parse-jornada', authenticateToken, requireGestor, [
  body('texto').notEmpty().withMessage('Texto da jornada obrigatório')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { texto } = req.body;

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada' });
    }

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Analise esta descrição de jornada de trabalho e retorne APENAS um JSON válido (sem markdown, sem explicação) com a estrutura abaixo. Se algum campo não puder ser determinado, use null.

Descrição: "${texto}"

Estrutura esperada:
{
  "dias_semana": ["seg", "ter", "qua", "qui", "sex"],
  "horario_entrada": "09:00",
  "horario_saida": "18:00",
  "carga_horaria_diaria": 8,
  "regra_hora_extra": "acima de 8h por dia",
  "folgas": [],
  "tipo_escala": "fixa",
  "observacoes": ""
}

Valores possíveis para tipo_escala: "fixa", "12x36", "escala", "diarista", "outro".
Dias da semana: "seg", "ter", "qua", "qui", "sex", "sab", "dom".`
      }]
    });

    const content = response.content[0].text.trim();
    let parsed;
    try {
      const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      return res.status(422).json({ error: 'Não foi possível interpretar a jornada', raw: content });
    }

    res.json({ jornada: parsed, texto_original: texto });
  } catch (err) {
    console.error('Parse jornada error:', err);
    res.status(500).json({ error: 'Erro ao processar jornada: ' + err.message });
  }
});

// GET /api/funcionarios/search
router.get('/search', authenticateToken, [
  query('q').notEmpty().trim().withMessage('Termo de busca obrigatório')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const funcionarios = Funcionario.search(req.query.q);
    res.json(funcionarios);
  } catch (err) {
    console.error('Search funcionarios error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/funcionarios/:id
router.get('/:id', authenticateToken, [
  param('id').isInt().withMessage('ID inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const funcionario = Funcionario.findById(req.params.id);
    if (!funcionario) {
      return res.status(404).json({ error: 'Funcionário não encontrado' });
    }
    res.json(funcionario);
  } catch (err) {
    console.error('Get funcionario error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/funcionarios
router.post('/', authenticateToken, requireGestor, [
  body('nome').notEmpty().trim().withMessage('Nome obrigatório'),
  body('cargo').optional().trim(),
  body('salario_hora').optional().isFloat({ min: 0 }).withMessage('Salário/hora inválido'),
  body('telefone').optional().trim(),
  body('horario_entrada').optional().matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Horário de entrada inválido (HH:MM)'),
  body('classificacao').optional().isIn(['operacional', 'assistente_pessoal', 'dono_casa', 'outro']).withMessage('Classificação inválida'),
  body('email_pessoal').optional().isEmail().withMessage('E-mail inválido'),
  body('pix_tipo').optional().isIn(['cpf', 'telefone', 'email', 'aleatoria']).withMessage('Tipo PIX inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const id = Funcionario.create(req.body);
    AuditLog.log(req.user.id, 'create', 'funcionario', id, { nome: req.body.nome, cargo: req.body.cargo }, req.ip);
    res.status(201).json({ id, message: 'Funcionário criado com sucesso' });
  } catch (err) {
    console.error('Create funcionario error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// PUT /api/funcionarios/:id
router.put('/:id', authenticateToken, requireGestor, [
  param('id').isInt().withMessage('ID inválido'),
  body('nome').optional().notEmpty().trim().withMessage('Nome não pode ser vazio'),
  body('cargo').optional().notEmpty().trim().withMessage('Cargo não pode ser vazio'),
  body('salario_hora').optional().isFloat({ min: 0 }).withMessage('Salário/hora inválido'),
  body('horario_entrada').optional().matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Horário de entrada inválido (HH:MM)')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const funcionario = Funcionario.findById(req.params.id);
    if (!funcionario) {
      return res.status(404).json({ error: 'Funcionário não encontrado' });
    }
    Funcionario.update(req.params.id, req.body);
    AuditLog.log(req.user.id, 'update', 'funcionario', parseInt(req.params.id), req.body, req.ip);
    res.json({ message: 'Funcionário atualizado com sucesso' });
  } catch (err) {
    console.error('Update funcionario error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// DELETE /api/funcionarios/:id (soft delete)
router.delete('/:id', authenticateToken, requireGestor, [
  param('id').isInt().withMessage('ID inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const funcionario = Funcionario.findById(req.params.id);
    if (!funcionario) {
      return res.status(404).json({ error: 'Funcionário não encontrado' });
    }
    Funcionario.delete(req.params.id);
    AuditLog.log(req.user.id, 'delete', 'funcionario', parseInt(req.params.id), { nome: funcionario.nome }, req.ip);
    res.json({ message: 'Funcionário desativado com sucesso' });
  } catch (err) {
    console.error('Delete funcionario error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/funcionarios/:id/desligar
router.post('/:id/desligar', authenticateToken, requireGestor, [
  param('id').isInt().withMessage('ID inválido'),
  body('motivo').optional().trim()
], (req, res) => {
  try {
    const funcionario = Funcionario.findById(req.params.id);
    if (!funcionario) {
      return res.status(404).json({ error: 'Funcionário não encontrado' });
    }
    Funcionario.desligar(req.params.id, req.body.motivo);
    AuditLog.log(req.user.id, 'desligar', 'funcionario', parseInt(req.params.id), { nome: funcionario.nome, motivo: req.body.motivo }, req.ip);
    res.json({ message: 'Funcionário desligado com sucesso' });
  } catch (err) {
    console.error('Desligar funcionario error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/funcionarios/:id/transportes
router.get('/:id/transportes', authenticateToken, [
  param('id').isInt().withMessage('ID inválido')
], (req, res) => {
  try {
    const transportes = Funcionario.getTransportes(parseInt(req.params.id));
    res.json(transportes);
  } catch (err) {
    console.error('Get transportes error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/funcionarios/:id/transportes
router.post('/:id/transportes', authenticateToken, requireGestor, [
  param('id').isInt().withMessage('ID inválido'),
  body('tipo').notEmpty().withMessage('Tipo de transporte obrigatório'),
  body('valor_trecho').isFloat({ min: 0 }).withMessage('Valor do trecho inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    Funcionario.addTransporte(parseInt(req.params.id), req.body);
    res.status(201).json({ message: 'Transporte adicionado' });
  } catch (err) {
    console.error('Add transporte error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// DELETE /api/funcionarios/transportes/:transporteId
router.delete('/transportes/:transporteId', authenticateToken, requireGestor, [
  param('transporteId').isInt().withMessage('ID inválido')
], (req, res) => {
  try {
    Funcionario.removeTransporte(parseInt(req.params.transporteId));
    res.json({ message: 'Transporte removido' });
  } catch (err) {
    console.error('Remove transporte error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
