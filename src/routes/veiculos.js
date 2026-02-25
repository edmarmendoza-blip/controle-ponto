const express = require('express');
const { body, param, validationResult } = require('express-validator');
const Veiculo = require('../models/Veiculo');
const { authenticateToken, requireGestor } = require('../middleware/auth');
const AuditLog = require('../services/auditLog');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Multer for CRLV photo upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'public', 'uploads', 'veiculos');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `crlv-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) cb(null, true);
  else cb(new Error('Apenas imagens são permitidas'));
}});

// GET /api/veiculos
router.get('/', authenticateToken, (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const veiculos = Veiculo.getAll(includeInactive);
    res.json(veiculos);
  } catch (err) {
    console.error('List veiculos error:', err);
    res.status(500).json({ error: 'Erro ao listar veículos' });
  }
});

// GET /api/veiculos/alerts
router.get('/alerts', authenticateToken, (req, res) => {
  try {
    const alerts = Veiculo.getAlerts();
    res.json(alerts);
  } catch (err) {
    console.error('Veiculos alerts error:', err);
    res.status(500).json({ error: 'Erro ao buscar alertas' });
  }
});

// GET /api/veiculos/:id
router.get('/:id', authenticateToken, [
  param('id').isInt().withMessage('ID inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const veiculo = Veiculo.findById(req.params.id);
    if (!veiculo) return res.status(404).json({ error: 'Veículo não encontrado' });
    res.json(veiculo);
  } catch (err) {
    console.error('Get veiculo error:', err);
    res.status(500).json({ error: 'Erro ao buscar veículo' });
  }
});

// POST /api/veiculos
router.post('/', authenticateToken, requireGestor, (req, res) => {
  try {
    const id = Veiculo.create(req.body);
    AuditLog.log(req.user.id, 'create', 'veiculo', id, { placa: req.body.placa, modelo: req.body.modelo }, req.ip);
    res.status(201).json({ id, message: 'Veículo cadastrado com sucesso' });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Já existe um veículo com esta placa' });
    }
    console.error('Create veiculo error:', err);
    res.status(500).json({ error: 'Erro ao cadastrar veículo' });
  }
});

// PUT /api/veiculos/:id
router.put('/:id', authenticateToken, requireGestor, [
  param('id').isInt().withMessage('ID inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const veiculo = Veiculo.findById(req.params.id);
    if (!veiculo) return res.status(404).json({ error: 'Veículo não encontrado' });
    Veiculo.update(req.params.id, req.body);
    AuditLog.log(req.user.id, 'update', 'veiculo', parseInt(req.params.id), req.body, req.ip);
    res.json({ message: 'Veículo atualizado com sucesso' });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Já existe um veículo com esta placa' });
    }
    console.error('Update veiculo error:', err);
    res.status(500).json({ error: 'Erro ao atualizar veículo' });
  }
});

// DELETE /api/veiculos/:id (soft delete)
router.delete('/:id', authenticateToken, requireGestor, [
  param('id').isInt().withMessage('ID inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const veiculo = Veiculo.findById(req.params.id);
    if (!veiculo) return res.status(404).json({ error: 'Veículo não encontrado' });
    Veiculo.delete(req.params.id);
    AuditLog.log(req.user.id, 'delete', 'veiculo', parseInt(req.params.id), { placa: veiculo.placa }, req.ip);
    res.json({ message: 'Veículo desativado com sucesso' });
  } catch (err) {
    console.error('Delete veiculo error:', err);
    res.status(500).json({ error: 'Erro ao desativar veículo' });
  }
});

// POST /api/veiculos/:id/crlv - Upload CRLV photo
router.post('/:id/crlv', authenticateToken, requireGestor, upload.single('foto'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhuma foto enviada' });
    const veiculo = Veiculo.findById(req.params.id);
    if (!veiculo) return res.status(404).json({ error: 'Veículo não encontrado' });
    const fotoPath = '/uploads/veiculos/' + req.file.filename;
    Veiculo.update(req.params.id, { crlv_foto_path: fotoPath });
    res.json({ message: 'CRLV enviado com sucesso', path: fotoPath });
  } catch (err) {
    console.error('Upload CRLV error:', err);
    res.status(500).json({ error: 'Erro ao enviar CRLV' });
  }
});

// POST /api/veiculos/analyze-crlv - Vision AI to extract data from CRLV photo
router.post('/analyze-crlv', authenticateToken, requireGestor, upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhuma foto enviada' });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada' });

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const imageData = fs.readFileSync(req.file.path);
    const base64 = imageData.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: 'Extraia todos os dados do veículo deste documento brasileiro (CRLV, seguro, IPVA, etc). Retorne APENAS JSON válido com os campos que encontrar: {"marca":"","modelo":"","ano_fabricacao":0,"ano_modelo":0,"cor":"","placa":"","renavam":"","chassi":"","combustivel":"","proprietario":"","seguradora":"","seguro_apolice":"","seguro_vigencia_inicio":"YYYY-MM-DD","seguro_vigencia_fim":"YYYY-MM-DD","seguro_valor":0,"ipva_valor":0,"ipva_vencimento":"YYYY-MM-DD"}. Omita campos que não encontrar. Responda SOMENTE com JSON.' }
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
      else throw new Error('Não foi possível extrair dados do documento');
    }

    // Save uploaded file path for reference
    data._foto_path = '/uploads/veiculos/' + req.file.filename;

    res.json({ success: true, data });
  } catch (err) {
    console.error('Analyze CRLV error:', err);
    res.status(500).json({ error: 'Erro ao analisar documento: ' + err.message });
  }
});

// POST /api/veiculos/buscar-placa - BigDataCorp vehicle lookup
router.post('/buscar-placa', authenticateToken, async (req, res) => {
  try {
    const { placa } = req.body;
    if (!placa) return res.status(400).json({ error: 'Placa obrigatória' });

    const token = process.env.BIGDATACORP_TOKEN;
    if (!token) return res.status(500).json({ error: 'BIGDATACORP_TOKEN não configurado' });

    const cleanPlaca = placa.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (cleanPlaca.length !== 7) return res.status(400).json({ error: 'Placa inválida (7 caracteres)' });

    const response = await fetch('https://bigboost.bigdatacorp.com.br/vehiclesv2', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        Datasets: 'vehicle_basic_data',
        q: 'plate{' + cleanPlaca + '}',
        Limit: 1
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[BigDataCorp] Vehicles error:', response.status, errText);
      if (response.status === 403 || response.status === 401) {
        return res.status(403).json({ error: 'Consulta por placa não disponível no seu plano BigDataCorp' });
      }
      return res.status(response.status).json({ error: 'Erro na consulta BigDataCorp' });
    }

    const result = await response.json();
    AuditLog.log(req.user.id, 'buscar_placa', 'veiculo', null, { placa: cleanPlaca }, req.ip);

    // Extract vehicle data from BigDataCorp response
    let vehicleData = null;
    if (result && result.Result) {
      const datasets = result.Result;
      for (const ds of datasets) {
        if (ds.MatchKeys && ds.BasicData) {
          const bd = Array.isArray(ds.BasicData) ? ds.BasicData[0] : ds.BasicData;
          if (bd) {
            vehicleData = {
              marca: bd.Brand || bd.Make || null,
              modelo: bd.Model || null,
              ano_fabricacao: bd.ManufactureYear || bd.YearManufacture || null,
              ano_modelo: bd.ModelYear || bd.YearModel || null,
              cor: bd.Color || null,
              placa: bd.Plate || cleanPlaca,
              renavam: bd.Renavam || null,
              chassi: bd.Chassis || bd.ChassisNumber || null,
              combustivel: bd.FuelType || bd.Fuel || null,
              tipo_veiculo: bd.VehicleType || null
            };
          }
        }
      }
    }

    // Try alternative response structure
    if (!vehicleData && result && Array.isArray(result)) {
      for (const item of result) {
        if (item.Result && Array.isArray(item.Result)) {
          for (const r of item.Result) {
            if (r.BasicData) {
              const bd = Array.isArray(r.BasicData) ? r.BasicData[0] : r.BasicData;
              if (bd) {
                vehicleData = {
                  marca: bd.Brand || bd.Make || null,
                  modelo: bd.Model || null,
                  ano_fabricacao: bd.ManufactureYear || null,
                  ano_modelo: bd.ModelYear || null,
                  cor: bd.Color || null,
                  placa: cleanPlaca,
                  renavam: bd.Renavam || null,
                  chassi: bd.Chassis || null,
                  combustivel: bd.FuelType || null
                };
              }
            }
          }
        }
      }
    }

    if (!vehicleData) {
      return res.json({ success: false, message: 'Veículo não encontrado', raw: result });
    }

    res.json({ success: true, data: vehicleData });
  } catch (err) {
    console.error('Buscar placa error:', err);
    res.status(500).json({ error: 'Erro ao buscar placa: ' + err.message });
  }
});

module.exports = router;
