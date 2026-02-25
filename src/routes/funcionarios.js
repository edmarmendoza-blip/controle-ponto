const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const Funcionario = require('../models/Funcionario');
const { authenticateToken, requireAdmin, requireGestor } = require('../middleware/auth');
const AuditLog = require('../services/auditLog');
const EmailService = require('../services/emailService');

const router = express.Router();

// Multer config for foto upload
const fotoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../public/uploads/funcionarios')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `func-${req.params.id}-${Date.now()}${ext}`);
  }
});
const fotoUpload = multer({
  storage: fotoStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(ext && mime ? null : new Error('Apenas imagens são permitidas'), ext && mime);
  }
});

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

// POST /api/funcionarios/enrich-cpf - BigDataCorp CPF lookup
router.post('/enrich-cpf', authenticateToken, requireGestor, async (req, res) => {
  try {
    const { cpf } = req.body;
    if (!cpf) return res.status(400).json({ error: 'CPF obrigatório' });

    const token = process.env.BIGDATACORP_TOKEN;
    if (!token) return res.status(500).json({ error: 'BIGDATACORP_TOKEN não configurado' });

    const cleanCpf = cpf.replace(/\D/g, '');
    if (cleanCpf.length !== 11) return res.status(400).json({ error: 'CPF inválido (11 dígitos)' });

    const response = await fetch('https://bigboost.bigdatacorp.com.br/peoplev2', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        Datasets: 'basic_data,emails,phones,addresses',
        q: 'doc{' + cleanCpf + '}',
        Limit: 1
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[BigDataCorp] People error:', response.status, errText);
      if (response.status === 403 || response.status === 401) {
        return res.status(403).json({ error: 'Consulta por CPF não disponível no seu plano BigDataCorp' });
      }
      return res.status(response.status).json({ error: 'Erro na consulta BigDataCorp' });
    }

    const result = await response.json();
    AuditLog.log(req.user.id, 'enrich_cpf', 'funcionario', null, { cpf: cleanCpf.substring(0, 3) + '***' }, req.ip);

    // Extract person data from BigDataCorp response
    let personData = null;

    // Try main response structure
    const extractData = (datasets) => {
      let data = {};
      for (const ds of (Array.isArray(datasets) ? datasets : [datasets])) {
        // Basic data
        if (ds.BasicData) {
          const bd = Array.isArray(ds.BasicData) ? ds.BasicData[0] : ds.BasicData;
          if (bd) {
            data.nome = bd.Name || bd.FullName || null;
            data.data_nascimento = bd.BirthDate ? bd.BirthDate.split('T')[0] : null;
            data.rg = bd.RG || null;
          }
        }
        // Emails
        if (ds.Emails) {
          const emails = Array.isArray(ds.Emails) ? ds.Emails : [ds.Emails];
          if (emails.length > 0) {
            const em = emails[0];
            data.email_pessoal = em.EmailAddress || em.Email || (typeof em === 'string' ? em : null);
          }
        }
        // Phones
        if (ds.Phones) {
          const phones = Array.isArray(ds.Phones) ? ds.Phones : [ds.Phones];
          const mobiles = phones.filter(p => p.PhoneType === 'Mobile' || p.Type === 'Mobile');
          const firstPhone = mobiles.length > 0 ? mobiles[0] : phones[0];
          if (firstPhone) {
            const num = firstPhone.Number || firstPhone.PhoneNumber || firstPhone.AreaCode + firstPhone.Number;
            if (num) data.telefone = num.replace(/\D/g, '');
          }
        }
        // Addresses
        if (ds.Addresses) {
          const addrs = Array.isArray(ds.Addresses) ? ds.Addresses : [ds.Addresses];
          if (addrs.length > 0) {
            const addr = addrs[0];
            data.endereco_cep = (addr.ZipCode || addr.Zipcode || '').replace(/\D/g, '') || null;
            data.endereco_rua = addr.AddressMain || addr.Street || null;
            data.endereco_numero = addr.Number || addr.AddressNumber || null;
            data.endereco_complemento = addr.Complement || null;
            data.endereco_bairro = addr.Neighborhood || null;
            data.endereco_cidade = addr.City || null;
            data.endereco_estado = addr.State || null;
          }
        }
      }
      return Object.keys(data).length > 0 ? data : null;
    };

    // Try nested Result array structure
    if (result && result.Result) {
      personData = extractData(result.Result);
    }
    // Try top-level array structure
    if (!personData && Array.isArray(result)) {
      for (const item of result) {
        if (item.Result) {
          personData = extractData(Array.isArray(item.Result) ? item.Result : [item.Result]);
          if (personData) break;
        }
      }
    }

    if (!personData) {
      return res.json({ success: false, message: 'Pessoa não encontrada', raw: result });
    }

    res.json({ success: true, data: personData });
  } catch (err) {
    console.error('Enrich CPF error:', err);
    res.status(500).json({ error: 'Erro ao consultar CPF: ' + err.message });
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

    // Send welcome email if employee has email
    if (req.body.email_pessoal) {
      const func = Funcionario.findById(id);
      EmailService.sendWelcome(func).catch(err => {
        console.error('[Email] Welcome email error:', err.message);
      });
    }

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
    const oldFeriasStatus = funcionario.ferias_status;
    Funcionario.update(req.params.id, req.body);
    AuditLog.log(req.user.id, 'update', 'funcionario', parseInt(req.params.id), req.body, req.ip);

    // Send vacation notification if status changed to approved
    if (req.body.ferias_status && req.body.ferias_status !== oldFeriasStatus) {
      const updated = Funcionario.findById(req.params.id);
      if (updated.notificacoes_ativas && updated.email_pessoal) {
        if (req.body.ferias_status === 'aprovada') {
          EmailService.sendVacationNotification(updated, 'aprovada').catch(err => {
            console.error('[Email] Vacation notification error:', err.message);
          });
        }
      }
    }

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

// POST /api/funcionarios/:id/foto
router.post('/:id/foto', authenticateToken, requireGestor, (req, res) => {
  fotoUpload.single('foto')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Erro no upload' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhuma foto enviada' });
    }
    try {
      const fotoPath = `/uploads/funcionarios/${req.file.filename}`;
      Funcionario.update(req.params.id, { foto: fotoPath });
      AuditLog.log(req.user.id, 'upload_foto', 'funcionario', parseInt(req.params.id), { foto: fotoPath }, req.ip);
      res.json({ message: 'Foto atualizada com sucesso', foto: fotoPath });
    } catch (err) {
      console.error('Upload foto error:', err);
      res.status(500).json({ error: 'Erro ao salvar foto' });
    }
  });
});

module.exports = router;
