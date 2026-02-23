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

module.exports = router;
