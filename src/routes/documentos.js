const express = require('express');
const { param, query, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Documento = require('../models/Documento');
const { authenticateToken, requireGestor } = require('../middleware/auth');
const AuditLog = require('../services/auditLog');

const router = express.Router();

// Helper: save document with proper directory structure
function saveDocumentPath(entidadeTipo, entidadeId, tipo) {
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').split('.')[0];
  const subdir = entidadeTipo === 'funcionario' ? 'funcionarios' : entidadeTipo === 'veiculo' ? 'veiculos' : 'avulsos';
  const dir = entidadeId
    ? path.join(__dirname, '..', '..', 'public', 'uploads', 'documentos', subdir, String(entidadeId))
    : path.join(__dirname, '..', '..', 'public', 'uploads', 'documentos', 'avulsos');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const entidadeTipo = req.body.entidade_tipo || 'avulso';
    const rawId = req.body.entidade_id;
    const entidadeId = rawId ? parseInt(rawId, 10) : null;
    if (rawId && (isNaN(entidadeId) || entidadeId < 0)) {
      return cb(new Error('ID de entidade inválido'));
    }
    const tipo = req.body.tipo || 'outro';
    const dir = saveDocumentPath(entidadeTipo, entidadeId, tipo);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const tipo = req.body.tipo || 'doc';
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').split('.')[0];
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${tipo}_${timestamp}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Apenas imagens e PDFs são permitidos'));
  }
});

// GET /api/documentos - List all documents
router.get('/', authenticateToken, (req, res) => {
  try {
    const filters = {
      tipo: req.query.tipo,
      entidade_tipo: req.query.entidade_tipo,
      entidade_id: req.query.entidade_id,
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim
    };
    const docs = Documento.getAll(filters);
    res.json(docs);
  } catch (err) {
    console.error('List documentos error:', err);
    res.status(500).json({ error: 'Erro ao listar documentos' });
  }
});

// GET /api/documentos/:entidade_tipo/:entidade_id - Documents for specific entity
router.get('/:entidade_tipo/:entidade_id', authenticateToken, [
  param('entidade_tipo').isIn(['funcionario', 'veiculo']).withMessage('Tipo de entidade inválido'),
  param('entidade_id').isInt().withMessage('ID inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const docs = Documento.getByEntity(req.params.entidade_tipo, parseInt(req.params.entidade_id));
    res.json(docs);
  } catch (err) {
    console.error('Get entity documentos error:', err);
    res.status(500).json({ error: 'Erro ao buscar documentos' });
  }
});

// POST /api/documentos/upload - Upload document
router.post('/upload', authenticateToken, requireGestor, upload.single('arquivo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    const { tipo, entidade_tipo, entidade_id, descricao } = req.body;
    if (!tipo || !entidade_tipo || !entidade_id) {
      return res.status(400).json({ error: 'Tipo, entidade_tipo e entidade_id são obrigatórios' });
    }

    const subdir = entidade_tipo === 'funcionario' ? 'funcionarios' : entidade_tipo === 'veiculo' ? 'veiculos' : 'avulsos';
    const relativePath = `/uploads/documentos/${subdir}/${entidade_id}/${req.file.filename}`;

    const id = Documento.create({
      tipo,
      descricao: descricao || null,
      entidade_tipo,
      entidade_id: parseInt(entidade_id),
      arquivo_path: relativePath,
      arquivo_original: req.file.originalname
    });

    AuditLog.log(req.user.id, 'upload_documento', 'documento', id, { tipo, entidade_tipo, entidade_id }, req.ip);
    res.status(201).json({ id, message: 'Documento enviado com sucesso', path: relativePath });
  } catch (err) {
    console.error('Upload documento error:', err);
    res.status(500).json({ error: 'Erro ao enviar documento' });
  }
});

// POST /api/documentos/analyze - Vision AI document analysis
router.post('/analyze', authenticateToken, requireGestor, upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada' });

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const imageData = fs.readFileSync(req.file.path);
    const base64 = imageData.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: `Analise este documento brasileiro. Identifique:
1. Tipo do documento (crlv, rg, cpf, cnh, comprovante_endereco, apolice_seguro, contrato, holerite, outro)
2. Extraia TODOS os dados legíveis (nomes, números, datas, endereços)
3. Se for documento de veículo: placa, marca, modelo, ano, renavam, chassi
4. Se for documento de pessoa: nome, cpf, rg, data_nascimento, endereco
Retorne APENAS JSON válido: { "type": "", "description": "", "extracted_data": {...}, "suggested_entity": "funcionario" ou "veiculo", "confidence": 0.0 }` }
        ]
      }]
    });

    const text = response.content[0].text.trim();
    let data;
    const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    try {
      data = JSON.parse(cleaned);
    } catch (e) {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) data = JSON.parse(match[0]);
      else throw new Error('Não foi possível analisar o documento');
    }

    // Try to match with existing entities
    const { db } = require('../config/database');
    let matches = [];
    const ext = data.extracted_data || {};

    if (ext.cpf) {
      const cpfClean = String(ext.cpf).replace(/\D/g, '');
      const func = db.prepare('SELECT id, nome FROM funcionarios WHERE cpf = ? AND status = ?').get(cpfClean, 'ativo');
      if (func) matches.push({ entidade_tipo: 'funcionario', entidade_id: func.id, nome: func.nome, match_field: 'cpf' });
    }
    if (ext.placa) {
      const placaClean = String(ext.placa).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      const veic = db.prepare("SELECT id, marca, modelo, placa FROM veiculos WHERE REPLACE(UPPER(placa), '-', '') = ? AND status = 'ativo'").get(placaClean);
      if (veic) matches.push({ entidade_tipo: 'veiculo', entidade_id: veic.id, nome: `${veic.marca} ${veic.modelo} - ${veic.placa}`, match_field: 'placa' });
    }
    if (ext.nome && matches.length === 0) {
      const funcs = db.prepare("SELECT id, nome FROM funcionarios WHERE nome LIKE ? AND status = 'ativo'").all('%' + ext.nome.split(' ')[0] + '%');
      for (const f of funcs) matches.push({ entidade_tipo: 'funcionario', entidade_id: f.id, nome: f.nome, match_field: 'nome' });
    }

    data._file_path = req.file.path;
    data._file_relative = `/uploads/documentos/${req.file.filename}`;
    data._matches = matches;

    AuditLog.log(req.user.id, 'analyze_documento', 'documento', null, { type: data.type }, req.ip);
    res.json({ success: true, data });
  } catch (err) {
    console.error('Analyze documento error:', err);
    res.status(500).json({ error: 'Erro ao analisar documento' });
  }
});

// DELETE /api/documentos/:id
router.delete('/:id', authenticateToken, requireGestor, [
  param('id').isInt().withMessage('ID inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const doc = Documento.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Documento não encontrado' });
    Documento.delete(req.params.id);
    AuditLog.log(req.user.id, 'delete_documento', 'documento', parseInt(req.params.id), { tipo: doc.tipo }, req.ip);
    res.json({ message: 'Documento excluído com sucesso' });
  } catch (err) {
    console.error('Delete documento error:', err);
    res.status(500).json({ error: 'Erro ao excluir documento' });
  }
});

module.exports = router;
