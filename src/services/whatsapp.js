const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { db } = require('../config/database');
const Registro = require('../models/Registro');
const Funcionario = require('../models/Funcionario');
const EmailService = require('./emailService');

// Portuguese keyword patterns for clock-in/out detection
const ENTRADA_PATTERNS = [
  /\b(cheguei|chegando|chegamos)\b/i,
  /\b(entrada)\b/i,
  /\b(bom\s*dia|bdia)\b/i,
  /\b(inici(ar|ei|ando))\b/i,
  /\b(come[cç](ar|ei|ando))\b/i,
  /\bt[oô]\s*(chegando|aqui|no\s*trabalho)\b/i,
  /\b(presente)\b/i,
];

const SAIDA_PATTERNS = [
  /\b(saindo|sa[ií]da|sa[ií])\b/i,
  /\b(tchau|xau|flw|falou)\b/i,
  /\b(fui|vazei|vazando)\b/i,
  /\b(indo\s*embora)\b/i,
  /\b(finaliz(ar|ei|ando))\b/i,
  /\bt[oô]\s*(saindo|indo)\b/i,
  /\b(vou\s*embora)\b/i,
  /\b(at[eé]\s*(amanh[aã]|segunda|logo))\b/i,
  /\b(encerrando)\b/i,
];

class WhatsAppService {
  constructor() {
    this.client = null;
    this.ready = false;
    this.groupChat = null;
    this.groupId = null;
    this.qrCode = null; // current QR code string for web display
    this.status = 'disconnected'; // disconnected, waiting_qr, connected, initializing
    this._initRetries = 0;
    this._maxRetries = 3;
    this._retryDelay = 30000; // 30s between retries
    this._retrying = false;
  }

  async initialize() {
    // Check if enabled in config
    const config = db.prepare("SELECT valor FROM configuracoes WHERE chave = 'whatsapp_enabled'").get();
    if (!config || config.valor !== 'true') {
      console.log('[WhatsApp] Service disabled. Set whatsapp_enabled=true in configuracoes to activate.');
      return;
    }

    const groupName = process.env.WHATSAPP_GROUP_NAME;
    if (!groupName) {
      console.log('[WhatsApp] WHATSAPP_GROUP_NAME not set in .env. Aborting.');
      return;
    }

    console.log('[WhatsApp] Initializing client...');
    this.status = 'initializing';

    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--single-process',
        ],
      },
    });

    this.client.on('qr', async (qr) => {
      this.status = 'waiting_qr';
      this.qrCode = qr;
      console.log('[WhatsApp] QR code received. Scan at: /api/whatsapp/qr');
      qrcode.generate(qr, { small: true });
      // Also save as PNG image for web access
      try {
        const qrImagePath = path.join(__dirname, '..', '..', 'public', 'whatsapp-qr.png');
        await QRCode.toFile(qrImagePath, qr, { width: 400, margin: 2 });
        console.log('[WhatsApp] QR code image saved to /whatsapp-qr.png');
      } catch (err) {
        console.error('[WhatsApp] Error saving QR image:', err.message);
      }
    });

    this.client.on('ready', async () => {
      this.ready = true;
      this.qrCode = null;
      this.status = 'connected';
      this._initRetries = 0;
      console.log('[WhatsApp] Client connected and ready!');
      await this.findGroup();
    });

    this.client.on('authenticated', () => {
      this.qrCode = null;
      console.log('[WhatsApp] Authenticated successfully.');
    });

    this.client.on('auth_failure', (msg) => {
      console.error('[WhatsApp] Authentication failed:', msg);
      this.ready = false;
      this.status = 'disconnected';
    });

    this.client.on('change_state', (state) => {
      console.log('[WhatsApp] State changed:', state);
    });

    this.client.on('disconnected', (reason) => {
      console.log('[WhatsApp] Disconnected:', reason);
      this.ready = false;
      this.status = 'disconnected';
      this.groupChat = null;
      this.groupId = null;
      // Send email alert
      EmailService.sendWhatsAppAlert(reason).catch(err => {
        console.error('[WhatsApp] Error sending disconnect alert:', err.message);
      });
      // Auto-reconnect with retry
      this._initRetries = 0;
      this._retryInitialize();
    });

    this.client.on('message_create', async (msg) => {
      try {
        await this.onMessage(msg);
      } catch (err) {
        console.error('[WhatsApp] Error processing message:', err);
      }
    });

    await this._attemptInitialize();
  }

  async _attemptInitialize() {
    this._initRetries = 0;
    await this._retryInitialize();
  }

  async _retryInitialize() {
    if (this._retrying) {
      console.log('[WhatsApp] Retry already in progress, skipping.');
      return;
    }
    this._retrying = true;
    try {
      while (this._initRetries < this._maxRetries) {
        this._initRetries++;
        const attempt = this._initRetries;
        try {
          console.log(`[WhatsApp] Initialize attempt ${attempt}/${this._maxRetries}...`);
          this.status = 'initializing';
          await this.client.initialize();
          return; // success
        } catch (err) {
          console.error(`[WhatsApp] Initialize attempt ${attempt} failed:`, err.message);
          if (attempt < this._maxRetries) {
            console.log(`[WhatsApp] Retrying in ${this._retryDelay / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, this._retryDelay));
          }
        }
      }
      console.error(`[WhatsApp] All ${this._maxRetries} initialize attempts failed.`);
      this.status = 'disconnected';
    } finally {
      this._retrying = false;
    }
  }

  async reconnect() {
    console.log('[WhatsApp] Manual reconnect requested.');
    if (this.status === 'initializing') {
      return { success: false, message: 'Já está tentando conectar.' };
    }
    if (this.status === 'connected') {
      return { success: false, message: 'Já está conectado.' };
    }

    // Destroy existing client if needed, removing listeners first to prevent
    // the old 'disconnected' event from triggering a competing retry loop
    try {
      if (this.client) {
        this.client.removeAllListeners();
        await this.client.destroy();
      }
    } catch (err) {
      console.error('[WhatsApp] Error destroying old client:', err.message);
    }

    this.ready = false;
    this.groupChat = null;
    this.groupId = null;
    this.qrCode = null;

    // Re-initialize from scratch
    try {
      await this.initialize();
      return { success: true, message: 'Reconexão iniciada.' };
    } catch (err) {
      return { success: false, message: 'Falha ao reconectar: ' + err.message };
    }
  }

  async findGroup() {
    const groupName = process.env.WHATSAPP_GROUP_NAME;
    console.log(`[WhatsApp] Searching for group: "${groupName}"`);

    try {
      const chats = await this.client.getChats();
      const group = chats.find(
        (chat) => chat.isGroup && chat.name.toLowerCase().includes(groupName.toLowerCase())
      );

      if (group) {
        this.groupChat = group;
        this.groupId = group.id._serialized;
        console.log(`[WhatsApp] Found group: "${group.name}" (${this.groupId})`);
      } else {
        console.log(`[WhatsApp] Group "${groupName}" not found. Available groups:`);
        chats
          .filter((c) => c.isGroup)
          .forEach((c) => console.log(`  - "${c.name}"`));
      }
    } catch (err) {
      console.error('[WhatsApp] Error finding group:', err.message);
    }
  }

  async onMessage(msg) {
    // Only process messages from our target group
    if (!this.groupId || msg.from !== this.groupId) return;

    // Ignore messages from the bot itself
    if (msg.fromMe) return;

    const contact = await msg.getContact();
    const senderPhone = contact.number || '';
    const senderName = contact.pushname || contact.name || '';
    const text = (msg.body || '').trim();

    // Download media if present
    let mediaType = null;
    let mediaPath = null;
    let visionAnalysis = null;
    if (msg.hasMedia) {
      try {
        const media = await msg.downloadMedia();
        if (media) {
          mediaType = media.mimetype.split('/')[0]; // image, video, audio, etc.
          const today = new Date().toISOString().split('T')[0];
          const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'whatsapp', today);
          fs.mkdirSync(uploadDir, { recursive: true });
          const ext = media.mimetype.split('/')[1]?.split(';')[0] || 'bin';
          const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const filePath = path.join(uploadDir, filename);
          fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));
          mediaPath = `/uploads/whatsapp/${today}/${filename}`;
          console.log(`[WhatsApp] Media saved: ${mediaPath} (${mediaType})`);

          // Analyze images with Claude Vision
          if (mediaType === 'image' && process.env.ANTHROPIC_API_KEY) {
            visionAnalysis = await this.analyzeImage(media.data, media.mimetype, senderName, text);
          }
        }
      } catch (err) {
        console.error('[WhatsApp] Error downloading media:', err.message);
      }
    }

    // Skip messages with no text and no media
    if (!text && !mediaType) return;

    // Match employee
    let funcionario = this.matchEmployee(senderPhone, senderName);

    // Detect intent (only from text)
    const intent = text ? this.parseIntent(text) : null;

    // Auto-create employee if not found and has a clock intent
    if (!funcionario && intent && senderName) {
      funcionario = this.autoCreateEmployee(senderPhone, senderName);
    }

    // Store the message (append vision analysis to text if available)
    const storedText = visionAnalysis ? (text ? `${text}\n\n[Análise IA]: ${visionAnalysis}` : `[Análise IA]: ${visionAnalysis}`) : text;
    this.storeMessage(msg.id._serialized, senderPhone, senderName, funcionario?.id || null, storedText, intent || 'other', mediaType, mediaPath);

    // If clock-in/out intent detected and employee found, register the punch
    if (intent && funcionario) {
      await this.registerPunch(funcionario, intent, msg);
    } else if (intent && !funcionario) {
      console.log(`[WhatsApp] Punch intent "${intent}" but could not create employee: ${senderName} (${senderPhone})`);
    }
  }

  parseIntent(text) {
    // Check entrada patterns
    for (const pattern of ENTRADA_PATTERNS) {
      if (pattern.test(text)) return 'entrada';
    }
    // Check saida patterns
    for (const pattern of SAIDA_PATTERNS) {
      if (pattern.test(text)) return 'saida';
    }
    return null;
  }

  matchEmployee(phone, pushName) {
    const funcionarios = Funcionario.getAll();

    // 1. Try matching by phone number
    if (phone) {
      const normalizedPhone = this.normalizePhone(phone);
      const byPhone = funcionarios.find((f) => {
        if (!f.telefone) return false;
        return this.normalizePhone(f.telefone) === normalizedPhone;
      });
      if (byPhone) return byPhone;
    }

    // 2. Fallback: match by name (case-insensitive, partial)
    if (pushName) {
      const normalizedName = this.normalizeName(pushName);
      // Try exact match first
      const exact = funcionarios.find(
        (f) => this.normalizeName(f.nome) === normalizedName
      );
      if (exact) return exact;

      // Try partial match (push name contains first name or vice versa)
      const partial = funcionarios.find((f) => {
        const fName = this.normalizeName(f.nome);
        const firstName = fName.split(' ')[0];
        const pushFirst = normalizedName.split(' ')[0];
        return firstName === pushFirst || fName.includes(normalizedName) || normalizedName.includes(fName);
      });
      if (partial) return partial;
    }

    return null;
  }

  autoCreateEmployee(phone, pushName) {
    try {
      // Format phone for storage
      const formattedPhone = phone ? this.formatPhoneForDisplay(phone) : null;

      const id = Funcionario.create({
        nome: pushName,
        cargo: 'A definir',
        salario_hora: 0,
        telefone: formattedPhone,
        status: 'ativo',
      });

      const funcionario = Funcionario.findById(id);
      console.log(`[WhatsApp] Auto-created employee: ${pushName} (${formattedPhone}) -> ID ${id}`);
      return funcionario;
    } catch (err) {
      console.error(`[WhatsApp] Error auto-creating employee ${pushName}:`, err.message);
      return null;
    }
  }

  formatPhoneForDisplay(phone) {
    const digits = phone.replace(/\D/g, '');
    // Format as (DD) XXXXX-XXXX for Brazilian numbers
    if (digits.length === 11) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    }
    if (digits.length === 13 && digits.startsWith('55')) {
      const local = digits.slice(2);
      return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
    }
    return phone;
  }

  normalizePhone(phone) {
    // Strip everything except digits
    const digits = phone.replace(/\D/g, '');
    // If starts with 55 (Brazil country code) and has 12-13 digits, strip it
    if (digits.startsWith('55') && digits.length >= 12) {
      return digits.slice(2);
    }
    return digits;
  }

  normalizeName(name) {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove accents
      .trim();
  }

  storeMessage(messageId, senderPhone, senderName, funcionarioId, text, messageType, mediaType = null, mediaPath = null) {
    try {
      db.prepare(`
        INSERT OR IGNORE INTO whatsapp_mensagens
          (message_id, sender_phone, sender_name, funcionario_id, message_text, message_type, processed, media_type, media_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(messageId, senderPhone, senderName, funcionarioId, text, messageType, messageType !== 'other' ? 1 : 0, mediaType, mediaPath);
    } catch (err) {
      console.error('[WhatsApp] Error storing message:', err.message);
    }
  }

  async registerPunch(funcionario, intent, msg) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const currentTime = now.toTimeString().slice(0, 5); // HH:MM

    try {
      if (intent === 'entrada') {
        // Check if already has an entrada today
        const existing = db.prepare(
          'SELECT id FROM registros WHERE funcionario_id = ? AND data = ? AND entrada IS NOT NULL'
        ).get(funcionario.id, today);

        if (existing) {
          await this.sendGroupMessage(
            `${funcionario.nome}, sua entrada de hoje ja foi registrada.`
          );
          return;
        }

        Registro.create({
          funcionario_id: funcionario.id,
          data: today,
          entrada: currentTime,
          saida: null,
          tipo: 'whatsapp',
          observacao: `Via WhatsApp: "${msg.body.trim().substring(0, 100)}"`,
        });

        console.log(`[WhatsApp] Entrada registered: ${funcionario.nome} at ${currentTime}`);
        await this.sendGroupMessage(
          `Entrada registrada para ${funcionario.nome} - ${currentTime}`
        );

      } else if (intent === 'saida') {
        // Find today's registro without saida
        const openRecord = db.prepare(
          'SELECT id FROM registros WHERE funcionario_id = ? AND data = ? AND entrada IS NOT NULL AND saida IS NULL'
        ).get(funcionario.id, today);

        if (openRecord) {
          // Update existing record with saida
          Registro.update(openRecord.id, { saida: currentTime }, null);
          console.log(`[WhatsApp] Saida registered: ${funcionario.nome} at ${currentTime}`);
          await this.sendGroupMessage(
            `Saida registrada para ${funcionario.nome} - ${currentTime}`
          );
        } else {
          // No open entrada found - register saida-only record
          Registro.create({
            funcionario_id: funcionario.id,
            data: today,
            entrada: null,
            saida: currentTime,
            tipo: 'whatsapp',
            observacao: `Via WhatsApp (saida sem entrada): "${msg.body.trim().substring(0, 100)}"`,
          });

          console.log(`[WhatsApp] Saida (no entrada) registered: ${funcionario.nome} at ${currentTime}`);
          await this.sendGroupMessage(
            `Saida registrada para ${funcionario.nome} - ${currentTime} (sem entrada registrada hoje)`
          );
        }
      }
    } catch (err) {
      if (err.message.includes('Ja existe') || err.message.includes('Já existe')) {
        await this.sendGroupMessage(
          `${funcionario.nome}, esse horario ja foi registrado hoje.`
        );
      } else {
        console.error(`[WhatsApp] Error registering punch for ${funcionario.nome}:`, err.message);
      }
    }
  }

  async analyzeImage(base64Data, mimetype, senderName, captionText) {
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const prompt = `Analise esta foto enviada por "${senderName}" no grupo de trabalho da residência "Lar Digital".
${captionText ? `Legenda da foto: "${captionText}"` : 'Sem legenda.'}

Descreva brevemente:
1. O que aparece na foto (entrega, serviço realizado, local, produto, etc.)
2. Se parece ser um registro de trabalho/entrega, descreva o que foi feito
3. Qualquer detalhe relevante (quantidade, estado, marca, etc.)

Responda em 2-3 frases curtas, direto ao ponto, em português.`;

      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimetype, data: base64Data } },
            { type: 'text', text: prompt }
          ]
        }]
      });

      const analysis = response.content[0]?.text || '';
      console.log(`[WhatsApp] Vision analysis: ${analysis.substring(0, 100)}...`);
      return analysis;
    } catch (err) {
      console.error('[WhatsApp] Vision analysis error:', err.message);
      return null;
    }
  }

  async sendGroupMessage(text) {
    if (!this.ready || !this.groupId) {
      console.log('[WhatsApp] Cannot send message - not connected or group not found.');
      return false;
    }
    try {
      await this.client.sendMessage(this.groupId, text);
      return true;
    } catch (err) {
      console.error('[WhatsApp] Error sending message:', err.message);
      return false;
    }
  }
}

module.exports = new WhatsAppService();
