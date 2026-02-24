const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { db } = require('../config/database');
const Registro = require('../models/Registro');
const Funcionario = require('../models/Funcionario');
const EmailService = require('./emailService');

// Confirmation response patterns
const SIM_PATTERNS = [/\bsim\b/i, /\bconfirm(?:o|ar|a)\b/i, /\bss\b/i, /\byes\b/i, /\bisso\b/i];
const NAO_PATTERNS = [/\bn[ãa]o\b/i, /\bnao\b/i, /\bcancel(?:a|ar)\b/i, /\bno\b/i, /\bnope\b/i];

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
    // Ignore messages from the bot itself
    if (msg.fromMe) return;

    // Handle private messages (for task creation and chat)
    const isPrivate = !msg.from.endsWith('@g.us');
    if (isPrivate) {
      await this.onPrivateMessage(msg);
      return;
    }

    // Only process group messages from our target group
    if (!this.groupId || msg.from !== this.groupId) return;

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

    // Prepare stored text (append vision analysis if available)
    const visionDesc = visionAnalysis?.descricao || null;
    const storedText = visionDesc ? (text ? `${text}\n\n[Análise IA]: ${visionDesc}` : `[Análise IA]: ${visionDesc}`) : text;

    // Expire old pending confirmations
    this.expireOldConfirmations();

    // Check if this is a confirmation response (SIM/NÃO)
    const confirmFuncId = funcionario?.id || 0;
    if (text) {
      const pending = this.getPendingConfirmation(confirmFuncId);
      if (pending) {
        const response = this.checkConfirmationResponse(text);
        if (response === 'confirmed') {
          this.resolvePendingConfirmation(pending.id, 'confirmed');

          // Handle entrega confirmation
          if (pending.tipo === 'entrega') {
            try {
              const entregaInfo = JSON.parse(pending.message_text);
              const Entrega = require('../models/Entrega');
              const entregaId = Entrega.create({
                funcionario_id: entregaInfo.funcionario_id || null,
                imagem_path: entregaInfo.imagem_path,
                destinatario: entregaInfo.destinatario || null,
                remetente: entregaInfo.remetente || null,
                transportadora: entregaInfo.transportadora || null,
                descricao: entregaInfo.descricao,
                whatsapp_mensagem_id: entregaInfo.whatsapp_mensagem_id
              });
              const dest = entregaInfo.destinatario ? ` para ${entregaInfo.destinatario}` : '';
              await this.sendGroupMessage(`✅ Entrega #${entregaId} registrada${dest}!`);
              console.log(`[WhatsApp] Entrega #${entregaId} confirmed by ${senderName}`);
            } catch (err) {
              console.error('[WhatsApp] Error creating confirmed entrega:', err.message);
              await this.sendGroupMessage(`❌ Erro ao registrar entrega: ${err.message}`);
            }
            this.storeMessage(msg.id._serialized, senderPhone, senderName, funcionario?.id || null, storedText, 'other', mediaType, mediaPath);
            return;
          }

          // Register with the adjusted time
          try {
            if (pending.tipo === 'entrada') {
              const existing = db.prepare(
                'SELECT id FROM registros WHERE funcionario_id = ? AND data = ? AND entrada IS NOT NULL'
              ).get(funcionario.id, pending.data);
              if (!existing) {
                Registro.create({
                  funcionario_id: funcionario.id,
                  data: pending.data,
                  entrada: pending.horario,
                  saida: null,
                  tipo: 'whatsapp',
                  observacao: `Via WhatsApp (ajuste confirmado): "${pending.message_text || ''}"`,
                });
                await this.sendGroupMessage(`✅ Entrada registrada para ${funcionario.nome} às ${pending.horario} (ajuste confirmado)`);
              } else {
                await this.sendGroupMessage(`${funcionario.nome}, sua entrada de hoje já foi registrada.`);
              }
            } else if (pending.tipo === 'saida') {
              const openRecord = db.prepare(
                'SELECT id FROM registros WHERE funcionario_id = ? AND data = ? AND entrada IS NOT NULL AND saida IS NULL'
              ).get(funcionario.id, pending.data);
              if (openRecord) {
                Registro.update(openRecord.id, { saida: pending.horario }, null);
                await this.sendGroupMessage(`✅ Saída registrada para ${funcionario.nome} às ${pending.horario} (ajuste confirmado)`);
              } else {
                Registro.create({
                  funcionario_id: funcionario.id,
                  data: pending.data,
                  entrada: null,
                  saida: pending.horario,
                  tipo: 'whatsapp',
                  observacao: `Via WhatsApp (ajuste confirmado, sem entrada): "${pending.message_text || ''}"`,
                });
                await this.sendGroupMessage(`✅ Saída registrada para ${funcionario.nome} às ${pending.horario} (ajuste confirmado, sem entrada)`);
              }
            }
          } catch (err) {
            console.error(`[WhatsApp] Error registering adjusted punch:`, err.message);
            await this.sendGroupMessage(`❌ Erro ao registrar ajuste para ${funcionario.nome}: ${err.message}`);
          }
          // Store confirmation message and return (don't process further)
          this.storeMessage(msg.id._serialized, senderPhone, senderName, funcionario?.id || null, storedText, 'other', mediaType, mediaPath);
          return;
        } else if (response === 'denied') {
          this.resolvePendingConfirmation(pending.id, 'denied');
          if (pending.tipo === 'entrega') {
            await this.sendGroupMessage(`📦 Entrega ignorada.`);
          } else {
            await this.sendGroupMessage(`❌ Ajuste cancelado para ${funcionario.nome}.`);
          }
          this.storeMessage(msg.id._serialized, senderPhone, senderName, funcionario?.id || null, storedText, 'other', mediaType, mediaPath);
          return;
        }
      }
    }

    // AI-based intent detection (replaces regex parseIntent and parseTimeAdjustment)
    let intent = null;
    if (text) {
      // Skip AI for very short non-alphanumeric messages (emoji, stickers)
      const alphanumCount = (text.match(/[a-zA-Z0-9\u00C0-\u024F]/g) || []).length;
      if (alphanumCount >= 2) {
        const allFuncionarios = Funcionario.getAll();
        const aiResult = await this.parseMessageWithAI(text, senderName, allFuncionarios);

        if (aiResult && aiResult.tipo && aiResult.confianca >= 50) {
          // If AI detected an explicit time (adjustment) -> ask for confirmation
          if (aiResult.horario && funcionario) {
            const today = new Date().toISOString().split('T')[0];
            const tipoLabel = aiResult.tipo === 'entrada' ? 'entrada' : 'saída';
            this.createPendingConfirmation(funcionario.id, aiResult.tipo, today, aiResult.horario, text);
            await this.sendGroupMessage(
              `${funcionario.nome}, deseja registrar ${tipoLabel} às ${aiResult.horario}? Responda *SIM* ou *NÃO*.`
            );
            this.storeMessage(msg.id._serialized, senderPhone, senderName, funcionario?.id || null, storedText, 'other', mediaType, mediaPath);
            return;
          }

          if (aiResult.confianca >= 80) {
            intent = aiResult.tipo; // High confidence -> auto register
          } else {
            // 50-79% confidence -> ask for confirmation with current time
            if (funcionario) {
              const today = new Date().toISOString().split('T')[0];
              const currentTime = new Date().toTimeString().slice(0, 5);
              const tipoLabel = aiResult.tipo === 'entrada' ? 'entrada' : 'saída';
              this.createPendingConfirmation(funcionario.id, aiResult.tipo, today, currentTime, text);
              await this.sendGroupMessage(
                `${funcionario.nome}, deseja registrar ${tipoLabel} às ${currentTime}? Responda *SIM* ou *NÃO*.`
              );
              this.storeMessage(msg.id._serialized, senderPhone, senderName, funcionario?.id || null, storedText, 'other', mediaType, mediaPath);
              return;
            }
          }
        }
        // confianca < 50 or null -> ignore (intent stays null)
      }
    }

    // Auto-create employee if not found and has a clock intent
    if (!funcionario && intent && senderName) {
      funcionario = this.autoCreateEmployee(senderPhone, senderName);
    }

    // Store the message
    // Map lunch intents to 'other' for whatsapp_mensagens message_type (which only allows entrada/saida/other)
    const msgType = (intent === 'entrada' || intent === 'saida') ? intent : 'other';
    const msgDbId = this.storeMessage(msg.id._serialized, senderPhone, senderName, funcionario?.id || null, storedText, msgType, mediaType, mediaPath);

    // Ask for confirmation when AI detects a delivery photo
    if (visionAnalysis?.is_entrega && mediaPath) {
      try {
        const entregaData = JSON.stringify({
          type: 'entrega',
          funcionario_id: funcionario?.id || null,
          imagem_path: mediaPath,
          destinatario: visionAnalysis.destinatario || null,
          remetente: visionAnalysis.remetente || null,
          transportadora: visionAnalysis.transportadora || null,
          descricao: visionAnalysis.descricao,
          whatsapp_mensagem_id: msgDbId
        });
        const funcId = funcionario?.id || 0;
        this.createPendingConfirmation(funcId, 'entrega', new Date().toISOString().split('T')[0], '00:00', entregaData);
        const dest = visionAnalysis.destinatario ? ` para *${visionAnalysis.destinatario}*` : '';
        const rem = visionAnalysis.remetente ? ` de *${visionAnalysis.remetente}*` : '';
        await this.sendGroupMessage(
          `📦 ${senderName}, isso é uma entrega${dest}${rem}? Responda *SIM* para registrar ou *NÃO* para ignorar.`
        );
        console.log(`[WhatsApp] Delivery confirmation requested from ${senderName}`);
      } catch (err) {
        console.error('[WhatsApp] Error requesting entrega confirmation:', err.message);
      }
    }

    // Check for task completion messages in group
    if (text && funcionario) {
      const taskDoneMatch = /tarefa\s+conclu[ií]da|terminei\s+(?:a\s+)?tarefa|tarefa\s+(?:feita|pronta|finalizada)/i.test(text);
      if (taskDoneMatch) {
        try {
          const pendingTasks = db.prepare(`
            SELECT tf.tarefa_id, t.titulo FROM tarefa_funcionarios tf
            JOIN tarefas t ON tf.tarefa_id = t.id
            WHERE tf.funcionario_id = ? AND tf.status != 'concluida' AND t.status != 'cancelada'
            ORDER BY t.prazo ASC NULLS LAST LIMIT 1
          `).get(funcionario.id);
          if (pendingTasks) {
            const Tarefa = require('../models/Tarefa');
            Tarefa.updateFuncionarioStatus(pendingTasks.tarefa_id, funcionario.id, 'concluida');
            await this.sendGroupMessage(`✅ Tarefa "${pendingTasks.titulo}" marcada como concluída para ${funcionario.nome}!`);
          }
        } catch (e) {
          console.error('[WhatsApp] Task completion error:', e.message);
        }
      }
    }

    // If clock-in/out/lunch intent detected and employee found, register the punch
    if (intent && funcionario) {
      await this.registerPunch(funcionario, intent, msg);
    } else if (intent && !funcionario) {
      console.log(`[WhatsApp] Punch intent "${intent}" but could not create employee: ${senderName} (${senderPhone})`);
    }
  }

  checkConfirmationResponse(text) {
    for (const pattern of SIM_PATTERNS) {
      if (pattern.test(text)) return 'confirmed';
    }
    for (const pattern of NAO_PATTERNS) {
      if (pattern.test(text)) return 'denied';
    }
    return null;
  }

  async parseMessageWithAI(text, senderName, funcionarios) {
    if (!process.env.ANTHROPIC_API_KEY) return null;

    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const now = new Date();
      const currentTime = now.toTimeString().slice(0, 5);
      const employeeNames = funcionarios.map(f => f.nome).join(', ');

      const prompt = `Você é um parser de mensagens de WhatsApp para controle de ponto de funcionários domésticos.

Horário atual: ${currentTime}
Remetente: ${senderName}
Funcionários cadastrados: ${employeeNames}

Classifique a mensagem em um dos tipos:
- "entrada": chegada ao trabalho (bom dia, cheguei, presente, começando, etc.)
- "saida": saída do trabalho (tchau, fui, boa noite, terminei, saindo, encerrado, etc.)
- "saida_almoco": saindo para almoço/intervalo
- "retorno_almoco": voltando do almoço/intervalo
- null: mensagem que NÃO é sobre registro de ponto (conversa, foto, pergunta, pedido, etc.)

Se a mensagem mencionar um horário específico (ex: "cheguei às 8:30", "saí 17h"), extraia no campo "horario" em formato HH:MM.

Responda APENAS com JSON, sem markdown:
{"tipo": "entrada"|"saida"|"saida_almoco"|"retorno_almoco"|null, "funcionario_nome": "nome ou null", "horario": "HH:MM ou null", "confianca": 0-100}

Mensagem: "${text}"`;

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }]
      });

      const responseText = (response.content[0]?.text || '').trim();

      // Parse JSON robustly (strip markdown code blocks if present)
      let jsonStr = responseText;
      const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

      // Try direct parse first, then regex fallback
      try {
        const result = JSON.parse(jsonStr);
        console.log(`[WhatsApp AI] "${text.substring(0, 50)}" -> tipo=${result.tipo}, confianca=${result.confianca}, horario=${result.horario}`);
        return result;
      } catch (parseErr) {
        // Regex fallback for malformed JSON
        const tipoMatch = jsonStr.match(/"tipo"\s*:\s*"([^"]+)"/);
        const confiancaMatch = jsonStr.match(/"confianca"\s*:\s*(\d+)/);
        const horarioMatch = jsonStr.match(/"horario"\s*:\s*"(\d{1,2}:\d{2})"/);

        if (tipoMatch && confiancaMatch) {
          const result = {
            tipo: tipoMatch[1] === 'null' ? null : tipoMatch[1],
            funcionario_nome: null,
            horario: horarioMatch ? horarioMatch[1] : null,
            confianca: parseInt(confiancaMatch[1])
          };
          console.log(`[WhatsApp AI] (regex fallback) "${text.substring(0, 50)}" -> tipo=${result.tipo}, confianca=${result.confianca}`);
          return result;
        }

        console.error('[WhatsApp AI] Failed to parse response:', responseText);
        return null;
      }
    } catch (err) {
      console.error('[WhatsApp AI] Error:', err.message);
      return null;
    }
  }

  createPendingConfirmation(funcionarioId, tipo, data, horario, messageText) {
    try {
      // Cancel any existing pending for this employee
      db.prepare(
        "UPDATE pending_confirmations SET status = 'expired', resolved_at = datetime('now','localtime') WHERE funcionario_id = ? AND status = 'pending'"
      ).run(funcionarioId);

      const result = db.prepare(
        'INSERT INTO pending_confirmations (funcionario_id, tipo, data, horario, message_text) VALUES (?, ?, ?, ?, ?)'
      ).run(funcionarioId, tipo, data, horario, messageText || null);
      return result.lastInsertRowid;
    } catch (err) {
      console.error('[WhatsApp] Error creating pending confirmation:', err.message);
      return null;
    }
  }

  getPendingConfirmation(funcionarioId) {
    return db.prepare(
      "SELECT * FROM pending_confirmations WHERE funcionario_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1"
    ).get(funcionarioId);
  }

  resolvePendingConfirmation(id, status) {
    db.prepare(
      "UPDATE pending_confirmations SET status = ?, resolved_at = datetime('now','localtime') WHERE id = ?"
    ).run(status, id);
  }

  expireOldConfirmations() {
    // Expire confirmations older than 30 minutes
    db.prepare(
      "UPDATE pending_confirmations SET status = 'expired', resolved_at = datetime('now','localtime') WHERE status = 'pending' AND created_at < datetime('now', 'localtime', '-30 minutes')"
    ).run();
  }

  // Known WhatsApp display name aliases -> funcionario name
  static NAME_ALIASES = {
    'amores da minha vida': 'roberto',
  };

  matchEmployee(phone, pushName) {
    const funcionarios = Funcionario.getAll();

    // 0. Check name aliases first
    if (pushName) {
      const normalized = this.normalizeName(pushName).replace(/[^\w\s]/g, '').trim();
      const aliasTarget = WhatsAppService.NAME_ALIASES[normalized];
      if (aliasTarget) {
        const aliased = funcionarios.find(f => this.normalizeName(f.nome).includes(aliasTarget));
        if (aliased) return aliased;
      }
    }

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
      const result = db.prepare(`
        INSERT OR IGNORE INTO whatsapp_mensagens
          (message_id, sender_phone, sender_name, funcionario_id, message_text, message_type, processed, media_type, media_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(messageId, senderPhone, senderName, funcionarioId, text, messageType, messageType !== 'other' ? 1 : 0, mediaType, mediaPath);
      if (result.changes > 0) return result.lastInsertRowid;
      // INSERT OR IGNORE: message already existed, fetch its ID
      const existing = db.prepare('SELECT id FROM whatsapp_mensagens WHERE message_id = ?').get(messageId);
      return existing?.id || null;
    } catch (err) {
      console.error('[WhatsApp] Error storing message:', err.message);
      return null;
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
      } else if (intent === 'saida_almoco') {
        // Register lunch break start
        Registro.create({
          funcionario_id: funcionario.id,
          data: today,
          entrada: null,
          saida: currentTime,
          tipo: 'whatsapp',
          observacao: `Via WhatsApp (saída almoço): "${msg.body.trim().substring(0, 100)}"`,
        });

        console.log(`[WhatsApp] Saida almoco registered: ${funcionario.nome} at ${currentTime}`);
        await this.sendGroupMessage(
          `Saída para almoço registrada para ${funcionario.nome} - ${currentTime}`
        );

      } else if (intent === 'retorno_almoco') {
        // Register lunch break return
        Registro.create({
          funcionario_id: funcionario.id,
          data: today,
          entrada: currentTime,
          saida: null,
          tipo: 'whatsapp',
          observacao: `Via WhatsApp (retorno almoço): "${msg.body.trim().substring(0, 100)}"`,
        });

        console.log(`[WhatsApp] Retorno almoco registered: ${funcionario.nome} at ${currentTime}`);
        await this.sendGroupMessage(
          `Retorno do almoço registrado para ${funcionario.nome} - ${currentTime}`
        );
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

Responda em 2-3 frases curtas, direto ao ponto, em português.

Ao final da sua resposta, inclua um bloco JSON no formato:
\`\`\`json
{"is_entrega": true/false, "destinatario": "nome ou null", "remetente": "empresa ou null", "transportadora": "empresa ou null"}
\`\`\`
- is_entrega: true se a foto mostra pacote, encomenda, caixa de entrega, correspondência ou similar
- destinatario: nome do destinatário se visível na etiqueta
- remetente: empresa/loja remetente se visível (Amazon, Mercado Livre, etc.)
- transportadora: empresa de transporte se visível (Correios, Jadlog, etc.)`;

      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
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

      // Parse structured JSON from end of response
      let structured = { is_entrega: false, destinatario: null, remetente: null, transportadora: null };
      try {
        const jsonMatch = analysis.match(/```json\s*([\s\S]*?)```/) || analysis.match(/(\{[^{}]*"is_entrega"[^{}]*\})/);
        if (jsonMatch) {
          structured = JSON.parse(jsonMatch[1].trim());
        }
      } catch (parseErr) {
        console.log('[WhatsApp] Vision JSON parse fallback, using defaults');
      }

      // Extract description text (everything before the JSON block)
      let descricao = analysis.replace(/```json[\s\S]*?```/, '').replace(/\{[^{}]*"is_entrega"[^{}]*\}/, '').trim();
      if (!descricao) descricao = analysis;

      return {
        descricao,
        is_entrega: !!structured.is_entrega,
        destinatario: structured.destinatario || null,
        remetente: structured.remetente || null,
        transportadora: structured.transportadora || null
      };
    } catch (err) {
      console.error('[WhatsApp] Vision analysis error:', err.message);
      return null;
    }
  }

  // Handle private messages (task creation + chat storage)
  async onPrivateMessage(msg) {
    try {
      const contact = await msg.getContact();
      const senderPhone = contact.number || '';
      const senderName = contact.pushname || contact.name || '';
      const text = (msg.body || '').trim();

      // Find matching user by phone
      const user = db.prepare("SELECT * FROM users WHERE telefone IS NOT NULL AND telefone != '' AND ? LIKE '%' || REPLACE(REPLACE(REPLACE(telefone, '(', ''), ')', ''), '-', '') || '%'").get(senderPhone);

      // Find matching funcionario for chat storage
      const func = this.matchEmployee(senderPhone, senderName);

      // Store as chat message if we can match a funcionario
      if (func) {
        let tipo = 'texto';
        let mediaPath = null;
        if (msg.hasMedia) {
          try {
            const media = await msg.downloadMedia();
            if (media) {
              const fs = require('fs');
              const path = require('path');
              const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'chat');
              fs.mkdirSync(uploadDir, { recursive: true });
              const ext = media.mimetype.split('/')[1]?.split(';')[0] || 'bin';
              const filename = `recv-${func.id}-${Date.now()}.${ext}`;
              fs.writeFileSync(path.join(uploadDir, filename), Buffer.from(media.data, 'base64'));
              mediaPath = `/uploads/chat/${filename}`;
              tipo = media.mimetype.startsWith('image') ? 'foto' : media.mimetype.startsWith('audio') ? 'audio' : 'arquivo';
            }
          } catch (e) {
            console.error('[WhatsApp] Private media download error:', e.message);
          }
        }
        db.prepare(`
          INSERT INTO whatsapp_chats (funcionario_id, direcao, tipo, conteudo, media_path)
          VALUES (?, 'recebida', ?, ?, ?)
        `).run(func.id, tipo, text || '', mediaPath);
      }

      // Check if user has task creation permission
      const canCreate = user && (user.role === 'admin' || user.pode_criar_tarefas_whatsapp);
      if (!canCreate) {
        if (text && text.length > 3) {
          // Only reply about permissions if it looks like a task command
          const looksLikeTask = /\btarefa\b|faz|levar?|comprar?|limpar?|arrumar?|amanhã|hoje/i.test(text);
          if (looksLikeTask) {
            await msg.reply('Você não tem permissão para criar tarefas via WhatsApp.');
          }
        }
        return;
      }

      // Process task creation via AI
      if (!text && !msg.hasMedia) return;

      let taskContent = text;
      let fonte = 'whatsapp_texto';

      // Handle audio: describe it
      if (msg.hasMedia && !text) {
        const media = msg.hasMedia ? await msg.downloadMedia().catch(() => null) : null;
        if (media && media.mimetype.startsWith('audio')) {
          fonte = 'whatsapp_audio';
          taskContent = '[Áudio recebido - transcrição não disponível]';
        } else if (media && media.mimetype.startsWith('image')) {
          fonte = 'whatsapp_foto';
          // Use Vision API if available
          if (process.env.ANTHROPIC_API_KEY && media) {
            try {
              const Anthropic = require('@anthropic-ai/sdk');
              const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
              const resp = await client.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 300,
                messages: [{ role: 'user', content: [
                  { type: 'image', source: { type: 'base64', media_type: media.mimetype, data: media.data } },
                  { type: 'text', text: 'Descreva brevemente esta imagem em português para criar uma tarefa. Máx 1 frase.' }
                ]}]
              });
              taskContent = resp.content[0]?.text || 'Tarefa com foto';
            } catch (e) {
              taskContent = 'Tarefa com foto anexada';
            }
          } else {
            taskContent = 'Tarefa com foto anexada';
          }
        }
      }

      if (!taskContent || taskContent.length < 3) return;

      // Use AI to parse the task
      if (!process.env.ANTHROPIC_API_KEY) {
        await msg.reply('API de IA não configurada. Não é possível interpretar tarefas.');
        return;
      }

      const allFuncionarios = Funcionario.getAll();
      const funcNames = allFuncionarios.map(f => f.nome).join(', ');

      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const resp = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: `Interprete esta mensagem como uma tarefa doméstica. Funcionários disponíveis: ${funcNames}.
Hoje é ${new Date().toISOString().split('T')[0]}.

Mensagem: "${taskContent}"

Retorne APENAS JSON válido (sem markdown):
{"titulo": "título curto da tarefa", "descricao": "descrição ou null", "funcionario": "nome do funcionário ou null", "prazo": "YYYY-MM-DD ou null", "prioridade": "alta|media|baixa"}` }]
      });

      let parsed;
      try {
        const raw = resp.content[0]?.text || '';
        const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        parsed = JSON.parse(cleaned);
      } catch (e) {
        await msg.reply('Não consegui interpretar a tarefa. Tente ser mais específico.');
        return;
      }

      // Find matching funcionario
      let assignedFunc = null;
      if (parsed.funcionario) {
        assignedFunc = allFuncionarios.find(f =>
          f.nome.toLowerCase().includes(parsed.funcionario.toLowerCase()) ||
          parsed.funcionario.toLowerCase().includes(f.nome.toLowerCase().split(' ')[0])
        );
      }

      // Create the task
      const Tarefa = require('../models/Tarefa');
      const tarefaId = Tarefa.create({
        titulo: parsed.titulo || taskContent.substring(0, 100),
        descricao: parsed.descricao || null,
        prioridade: parsed.prioridade || 'media',
        prazo: parsed.prazo || null,
        criado_por: user.id,
        fonte: fonte,
        funcionario_ids: assignedFunc ? [assignedFunc.id] : []
      });

      const funcLabel = assignedFunc ? assignedFunc.nome : 'Ninguém atribuído';
      const prazoLabel = parsed.prazo ? parsed.prazo.split('-').reverse().join('/') : 'Sem prazo';
      await msg.reply(`✅ Tarefa #${tarefaId} criada:\n📋 ${parsed.titulo}\n👤 ${funcLabel}\n📅 ${prazoLabel}`);

      // Notify assigned employee
      if (assignedFunc && assignedFunc.telefone) {
        const phone = assignedFunc.telefone.replace(/\D/g, '');
        const chatId = phone.startsWith('55') ? phone + '@c.us' : '55' + phone + '@c.us';
        this.client.sendMessage(chatId, `📋 Nova tarefa: ${parsed.titulo}${parsed.prazo ? ' - Prazo: ' + prazoLabel : ''}`).catch(() => {});
      }

      console.log(`[WhatsApp] Task #${tarefaId} created via private message from ${senderName}`);
    } catch (err) {
      console.error('[WhatsApp] Private message error:', err.message);
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
