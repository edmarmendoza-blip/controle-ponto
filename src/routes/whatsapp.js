const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const whatsappService = require('../services/whatsapp');
const { db } = require('../config/database');

const router = express.Router();

// GET /api/whatsapp/status - Check connection status
router.get('/status', authenticateToken, (req, res) => {
  res.json({
    status: whatsappService.status,
    ready: whatsappService.ready,
    group: whatsappService.groupId ? true : false,
    hasQr: !!whatsappService.qrCode,
  });
});

// GET /api/whatsapp/qr - Show QR code page (no auth required for easy phone scanning)
router.get('/qr', (req, res) => {
  const status = whatsappService.status;

  if (status === 'connected') {
    res.send(`
      <html><head><meta charset="utf-8"><title>WhatsApp - Conectado</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fff;text-align:center;}
      .ok{color:#22c55e;font-size:3rem;}</style></head>
      <body><div><div class="ok">&#10004;</div><h2>WhatsApp Conectado!</h2><p>O bot esta ativo e monitorando o grupo.</p></div></body></html>
    `);
    return;
  }

  if (!whatsappService.qrCode) {
    res.send(`
      <html><head><meta charset="utf-8"><title>WhatsApp - Aguardando</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta http-equiv="refresh" content="3">
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fff;text-align:center;}</style></head>
      <body><div><h2>Aguardando QR Code...</h2><p>O WhatsApp esta inicializando. Esta pagina recarrega automaticamente.</p></div></body></html>
    `);
    return;
  }

  res.send(`
    <html><head><meta charset="utf-8"><title>WhatsApp - Escanear QR</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="20">
    <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fff;text-align:center;}
    img{border-radius:12px;background:#fff;padding:16px;}</style></head>
    <body><div>
      <h2>Escanear QR Code do WhatsApp</h2>
      <p>Abra o WhatsApp no celular &gt; Dispositivos conectados &gt; Conectar dispositivo</p>
      <img src="/whatsapp-qr.png?t=${Date.now()}" alt="QR Code" width="400"/>
      <p style="color:#888;font-size:0.9rem;">A pagina recarrega a cada 20s. Se o QR expirar, aguarde o proximo.</p>
    </div></body></html>
  `);
});

// POST /api/whatsapp/reconnect - Force reconnection (admin only)
router.post('/reconnect', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await whatsappService.reconnect();
    if (result.success) {
      res.json({ success: true, message: result.message });
    } else {
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: 'Erro ao reconectar: ' + err.message });
  }
});

// POST /api/whatsapp/test - Send a test message to the group
router.post('/test', authenticateToken, requireAdmin, async (req, res) => {
  const message = req.body.message || 'Teste do bot de controle de ponto. Estou conectado e monitorando este grupo!';
  const sent = await whatsappService.sendGroupMessage(message);
  if (sent) {
    res.json({ success: true, message: 'Mensagem enviada!' });
  } else {
    res.status(500).json({ success: false, error: 'Falha ao enviar. Bot nao conectado ou grupo nao encontrado.' });
  }
});

// GET /api/whatsapp/messages - List messages with filtering
router.get('/messages', authenticateToken, (req, res) => {
  try {
    const { date, funcionario_id, media_only, media_type, page, limit: lim } = req.query;
    const limit = parseInt(lim) || 100;
    const offset = ((parseInt(page) || 1) - 1) * limit;

    let where = [];
    let params = [];

    if (date) {
      where.push('DATE(wm.created_at) = ?');
      params.push(date);
    }
    if (funcionario_id) {
      where.push('wm.funcionario_id = ?');
      params.push(parseInt(funcionario_id));
    }
    if (media_only === 'true') {
      where.push('wm.media_type IS NOT NULL');
    }
    if (media_type) {
      where.push('wm.media_type = ?');
      params.push(media_type);
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    const messages = db.prepare(`
      SELECT wm.*, f.nome as funcionario_nome
      FROM whatsapp_mensagens wm
      LEFT JOIN funcionarios f ON wm.funcionario_id = f.id
      ${whereClause}
      ORDER BY wm.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM whatsapp_mensagens wm ${whereClause}
    `).get(...params).count;

    res.json({ messages, total, page: parseInt(page) || 1, limit });
  } catch (err) {
    console.error('[WhatsApp] Messages list error:', err.message);
    res.status(500).json({ error: 'Erro ao buscar mensagens' });
  }
});

// POST /api/whatsapp/messages/:id/analyze - Re-analyze image with Claude Vision
router.post('/messages/:id/analyze', authenticateToken, async (req, res) => {
  try {
    const msg = db.prepare('SELECT * FROM whatsapp_mensagens WHERE id = ?').get(req.params.id);
    if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada' });
    if (msg.media_type !== 'image') return res.status(400).json({ error: 'Apenas imagens podem ser analisadas' });
    if (!msg.media_path) return res.status(400).json({ error: 'Arquivo de mídia não encontrado' });

    const filePath = require('path').join(__dirname, '..', '..', 'public', msg.media_path);
    const fs = require('fs');
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo não existe no disco' });

    const imageData = fs.readFileSync(filePath).toString('base64');
    const ext = msg.media_path.split('.').pop().toLowerCase();
    const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
    const mimetype = mimeMap[ext] || 'image/jpeg';

    const analysis = await whatsappService.analyzeImage(imageData, mimetype, msg.sender_name, msg.message_text);
    if (!analysis) return res.status(500).json({ error: 'Falha na análise da imagem' });

    // Update message text with analysis
    const originalText = msg.message_text || '';
    const cleanText = originalText.replace(/\n?\n?\[Análise IA\]:.*$/s, '');
    const newText = cleanText ? `${cleanText}\n\n[Análise IA]: ${analysis}` : `[Análise IA]: ${analysis}`;
    db.prepare('UPDATE whatsapp_mensagens SET message_text = ? WHERE id = ?').run(newText, msg.id);

    res.json({ success: true, analysis, message_text: newText });
  } catch (err) {
    console.error('[WhatsApp] Re-analyze error:', err.message);
    res.status(500).json({ error: 'Erro ao analisar imagem' });
  }
});

// POST /api/whatsapp/messages/:id/analyze-entrega - Analyze image for delivery info (OCR/Vision)
router.post('/messages/:id/analyze-entrega', authenticateToken, async (req, res) => {
  try {
    const msg = db.prepare('SELECT * FROM whatsapp_mensagens WHERE id = ?').get(req.params.id);
    if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada' });
    if (msg.media_type !== 'image') return res.status(400).json({ error: 'Apenas imagens podem ser analisadas' });
    if (!msg.media_path) return res.status(400).json({ error: 'Arquivo de mídia não encontrado' });

    const filePath = require('path').join(__dirname, '..', '..', 'public', msg.media_path);
    const fs = require('fs');
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo não existe no disco' });

    if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada' });

    const imageData = fs.readFileSync(filePath).toString('base64');
    const ext = msg.media_path.split('.').pop().toLowerCase();
    const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
    const mimetype = mimeMap[ext] || 'image/jpeg';

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimetype, data: imageData } },
          { type: 'text', text: `Analise esta foto de entrega/encomenda recebida em uma residência.
${msg.message_text ? `Legenda: "${msg.message_text}"` : ''}

Extraia as seguintes informações se visíveis na foto ou embalagem:
- Destinatário (para quem é)
- Remetente (quem enviou)
- Transportadora (empresa de entrega: Correios, Sedex, Jadlog, Mercado Livre, Amazon, etc.)
- Descrição do que aparece na foto

Retorne APENAS JSON válido (sem markdown):
{"destinatario": "nome ou null", "remetente": "nome ou null", "transportadora": "nome ou null", "descricao": "descrição breve da foto"}` }
        ]
      }]
    });

    const content = response.content[0]?.text || '';
    let entregaInfo;
    try {
      const cleaned = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      entregaInfo = JSON.parse(cleaned);
    } catch (e) {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        entregaInfo = JSON.parse(jsonMatch[0]);
      } else {
        entregaInfo = { destinatario: null, remetente: null, transportadora: null, descricao: content.substring(0, 200) };
      }
    }

    res.json({ success: true, entrega: entregaInfo });
  } catch (err) {
    console.error('[WhatsApp] Analyze entrega error:', err.message);
    res.status(500).json({ error: 'Erro ao analisar entrega: ' + err.message });
  }
});

module.exports = router;
