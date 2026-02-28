const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { db } = require('../config/database');
const Registro = require('../models/Registro');
const Funcionario = require('../models/Funcionario');
const EmailService = require('./emailService');
const elevenlabs = require('./elevenlabs');

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
    // Conversation memory per chat (key: chatId, value: array of {role, content, timestamp})
    this._chatMemory = new Map();
    this._memoryMaxAge = 10 * 60 * 1000; // 10 minutes
    this._memoryMaxMessages = 10; // max messages per chat
    // Anthropic SDK singleton (avoid creating new instance per message)
    this._anthropicClient = null;
    // Funcionarios cache (avoid querying DB on every message)
    this._funcionariosCache = null;
    this._funcionariosCacheTime = 0;
    this._funcionariosCacheTTL = 5 * 60 * 1000; // 5 minutes
  }

  // Get Anthropic client (singleton)
  _getAnthropicClient() {
    if (!this._anthropicClient && process.env.ANTHROPIC_API_KEY) {
      const Anthropic = require('@anthropic-ai/sdk');
      this._anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    return this._anthropicClient;
  }

  // Get all funcionarios with cache
  _getFuncionarios() {
    const now = Date.now();
    if (!this._funcionariosCache || (now - this._funcionariosCacheTime) > this._funcionariosCacheTTL) {
      this._funcionariosCache = Funcionario.getAll();
      this._funcionariosCacheTime = now;
    }
    return this._funcionariosCache;
  }

  // Add message to conversation memory
  _addToMemory(chatId, role, content) {
    if (!this._chatMemory.has(chatId)) this._chatMemory.set(chatId, []);
    const history = this._chatMemory.get(chatId);
    history.push({ role, content, timestamp: Date.now() });
    // Trim old messages
    const cutoff = Date.now() - this._memoryMaxAge;
    while (history.length > 0 && (history[0].timestamp < cutoff || history.length > this._memoryMaxMessages)) {
      history.shift();
    }
    // Periodic cleanup: remove stale chat entries from the Map
    this._cleanupMemory();
  }

  // Remove empty/expired chat entries to prevent Map from growing indefinitely
  _cleanupMemory() {
    const now = Date.now();
    if (this._lastMemoryCleanup && now - this._lastMemoryCleanup < 5 * 60 * 1000) return;
    this._lastMemoryCleanup = now;
    const cutoff = now - this._memoryMaxAge;
    for (const [chatId, history] of this._chatMemory) {
      // Remove entries where all messages are expired or array is empty
      if (history.length === 0 || history[history.length - 1].timestamp < cutoff) {
        this._chatMemory.delete(chatId);
      }
    }
  }

  // Get conversation history for AI context
  _getMemory(chatId) {
    if (!this._chatMemory.has(chatId)) return [];
    const history = this._chatMemory.get(chatId);
    const cutoff = Date.now() - this._memoryMaxAge;
    return history.filter(m => m.timestamp >= cutoff);
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

    // Kill orphan Chrome processes from previous runs (PM2 restart leaves them behind)
    try {
      const { execSync } = require('child_process');
      const authPath = path.resolve('.wwebjs_auth/session');
      const result = execSync(`ps aux | grep "[c]hrome.*${authPath.replace(/\//g, '\\/')}" | awk '{print $2}'`, { encoding: 'utf8' }).trim();
      if (result) {
        const pids = result.split('\n').filter(Boolean);
        console.log(`[WhatsApp] Killing ${pids.length} orphan Chrome process(es): ${pids.join(', ')}`);
        execSync(`kill -9 ${pids.join(' ')}`, { encoding: 'utf8' });
        // Wait a moment for processes to fully terminate
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (err) {
      // No orphan processes found or kill failed - safe to continue
    }

    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
      puppeteer: {
        headless: true,
        protocolTimeout: 120000,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--single-process',
          '--disable-extensions',
          '--disable-translate',
          '--no-zygote',
        ],
      },
      webVersionCache: {
        type: 'none',
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
    // Debug: log every incoming message
    console.log(`[WhatsApp] Message received: type=${msg.type} from=${msg.from} hasMedia=${msg.hasMedia} body="${(msg.body || '').substring(0, 50)}"`);

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
    let text = (msg.body || '').trim();

    // Track if original message was audio (for audio response mode)
    const isAudioMessage = msg.type === 'audio' || msg.type === 'ptt';
    let audioTranscription = null;
    let audioFilePath = null;

    // Handle audio: transcribe with ElevenLabs before processing
    if (isAudioMessage && process.env.ELEVENLABS_API_KEY) {
      const transcription = await this.transcribeAudio(msg);
      if (transcription) {
        text = transcription.text;
        audioTranscription = transcription.text;
        audioFilePath = transcription.audioPath;
        console.log(`[WhatsApp Audio] Group audio from ${senderName}: "${text.substring(0, 80)}"`);
      } else {
        return; // Transcription failed, error already sent to user
      }
    }

    // Download media if present (skip for already-handled audio)
    let mediaType = null;
    let mediaPath = null;
    let visionAnalysis = null;
    if (msg.hasMedia && !isAudioMessage) {
      try {
        const media = await msg.downloadMedia();
        if (media) {
          mediaType = media.mimetype.split('/')[0]; // image, video, audio, etc.
          const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
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
    } else if (isAudioMessage) {
      mediaType = 'audio';
      mediaPath = audioFilePath;
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
      console.log(`[WhatsApp] Checking confirmation for funcId=${confirmFuncId} text="${text.substring(0, 30)}"`);
      const pending = this.getPendingConfirmation(confirmFuncId);
      if (pending) {
        console.log(`[WhatsApp] Found pending #${pending.id} tipo=${pending.tipo} for funcId=${confirmFuncId}`);
        const response = this.checkConfirmationResponse(text);
        if (response === 'confirmed') {
          this.resolvePendingConfirmation(pending.id, 'confirmed');

          // Handle documento confirmation
          if (pending.tipo === 'documento') {
            try {
              const docData = JSON.parse(pending.message_text);
              const ext = docData.extracted_data || {};
              const entTipo = docData.suggested_entity;

              if (entTipo === 'veiculo' && ext.placa) {
                const Veiculo = require('../models/Veiculo');
                const existing = Veiculo.findByPlaca(ext.placa);
                if (existing) {
                  // Update existing vehicle with new data
                  const updates = {};
                  if (ext.renavam && !existing.renavam) updates.renavam = ext.renavam;
                  if (ext.chassi && !existing.chassi) updates.chassi = ext.chassi;
                  if (ext.combustivel && !existing.combustivel) updates.combustivel = ext.combustivel;
                  if (ext.cor && !existing.cor) updates.cor = ext.cor;
                  if (Object.keys(updates).length > 0) {
                    Veiculo.update(existing.id, updates);
                  }
                  if (docData.imagem_path) Veiculo.update(existing.id, { crlv_foto_path: docData.imagem_path });
                  await this.sendGroupMessage(`✅ Documento vinculado ao veículo ${existing.marca} ${existing.modelo} (${ext.placa}).`);
                } else {
                  const newId = Veiculo.create({
                    placa: ext.placa, marca: ext.marca || '', modelo: ext.modelo || '',
                    ano_fabricacao: ext.ano ? parseInt(ext.ano) : null, cor: ext.cor || '',
                    renavam: ext.renavam || '', chassi: ext.chassi || '',
                    combustivel: ext.combustivel || 'flex', crlv_foto_path: docData.imagem_path
                  });
                  await this.sendGroupMessage(`✅ Veículo criado (#${newId}): ${ext.placa} ${ext.marca || ''} ${ext.modelo || ''}.`);
                }
              } else if (entTipo === 'funcionario') {
                const Funcionario = require('../models/Funcionario');
                let func = ext.cpf ? db.prepare('SELECT id, nome FROM funcionarios WHERE cpf = ?').get(ext.cpf.replace(/\D/g, '')) : null;
                if (func) {
                  await this.sendGroupMessage(`✅ Documento vinculado a ${func.nome}.`);
                } else if (ext.nome || ext.cpf) {
                  const newId = Funcionario.create({ nome: ext.nome || 'Novo Funcionário', cpf: ext.cpf ? ext.cpf.replace(/\D/g, '') : null, rg: ext.rg || null });
                  await this.sendGroupMessage(`✅ Funcionário criado (#${newId}): ${ext.nome || ext.cpf}.`);
                }
              } else {
                await this.sendGroupMessage(`✅ Documento ${docData.document_type || ''} registrado.`);
              }
              console.log(`[WhatsApp] Document ${docData.document_type} confirmed by ${senderName}`);
            } catch (err) {
              console.error('[WhatsApp] Error handling document confirmation:', err.message);
              await this.sendGroupMessage(`❌ Erro ao registrar documento: ${err.message}`);
            }
            this.storeMessage(msg.id._serialized, senderPhone, senderName, funcionario?.id || null, storedText, 'other', mediaType, mediaPath);
            return;
          }

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

          // Handle sugestao confirmation (convert to task)
          if (pending.tipo === 'sugestao') {
            try {
              const sugData = JSON.parse(pending.message_text);
              const prioridadeMap = { alta: 'alta', media: 'media', baixa: 'baixa' };
              const result = db.prepare(`
                INSERT INTO tarefas (titulo, descricao, prioridade, criado_por, status, fonte, created_at)
                VALUES (?, ?, ?, NULL, 'pendente', 'whatsapp', datetime('now','localtime'))
              `).run(sugData.titulo, sugData.descricao || '', prioridadeMap[sugData.prioridade] || 'media');
              const tarefaId = result.lastInsertRowid;
              db.prepare(`
                UPDATE sugestoes_melhoria SET status = 'convertida', convertida_tarefa_id = ?, updated_at = datetime('now','localtime')
                WHERE id = ?
              `).run(tarefaId, sugData.sugestao_id);
              await this.sendGroupMessage(`✅ Tarefa #${tarefaId} criada: ${sugData.titulo}`);
              console.log(`[WhatsApp] Suggestion #${sugData.sugestao_id} converted to task #${tarefaId}`);
            } catch (err) {
              console.error('[WhatsApp] Error converting suggestion to task:', err.message);
              await this.sendGroupMessage(`❌ Erro ao criar tarefa: ${err.message}`);
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
            } else if (pending.tipo === 'saida_almoco') {
              const existingAlmoco = db.prepare(
                "SELECT id FROM registros WHERE funcionario_id = ? AND data = ? AND saida IS NOT NULL AND entrada IS NULL AND observacao LIKE '%saída almoço%'"
              ).get(funcionario.id, pending.data);
              if (!existingAlmoco) {
                Registro.create({
                  funcionario_id: funcionario.id,
                  data: pending.data,
                  entrada: null,
                  saida: pending.horario,
                  tipo: 'whatsapp',
                  observacao: `Via WhatsApp (saída almoço, ajuste confirmado): "${pending.message_text || ''}"`,
                });
                await this.sendGroupMessage(`✅ Saída almoço registrada para ${funcionario.nome} às ${pending.horario} (ajuste confirmado)`);
              } else {
                await this.sendGroupMessage(`${funcionario.nome}, saída para almoço já registrada hoje.`);
              }
            } else if (pending.tipo === 'retorno_almoco') {
              const existingRetorno = db.prepare(
                "SELECT id FROM registros WHERE funcionario_id = ? AND data = ? AND entrada IS NOT NULL AND saida IS NULL AND observacao LIKE '%retorno almoço%'"
              ).get(funcionario.id, pending.data);
              if (!existingRetorno) {
                Registro.create({
                  funcionario_id: funcionario.id,
                  data: pending.data,
                  entrada: pending.horario,
                  saida: null,
                  tipo: 'whatsapp',
                  observacao: `Via WhatsApp (retorno almoço, ajuste confirmado): "${pending.message_text || ''}"`,
                });
                await this.sendGroupMessage(`✅ Retorno almoço registrado para ${funcionario.nome} às ${pending.horario} (ajuste confirmado)`);
              } else {
                await this.sendGroupMessage(`${funcionario.nome}, retorno do almoço já registrado hoje.`);
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
          if (pending.tipo === 'documento') {
            await this.sendGroupMessage(`📄 Documento ignorado.`);
          } else if (pending.tipo === 'entrega') {
            await this.sendGroupMessage(`📦 Entrega ignorada.`);
          } else if (pending.tipo === 'sugestao') {
            try {
              const sugData = JSON.parse(pending.message_text);
              db.prepare("UPDATE sugestoes_melhoria SET status = 'ignorada', updated_at = datetime('now','localtime') WHERE id = ?").run(sugData.sugestao_id);
            } catch (e) { /* ignore */ }
            await this.sendGroupMessage(`Ok, sugestão arquivada.`);
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
        const allFuncionarios = this._getFuncionarios();
        const aiResult = await this.parseMessageWithAI(text, senderName, allFuncionarios);

        if (aiResult && aiResult.tipo && aiResult.confianca >= 50) {
          // If AI detected an explicit time (adjustment)
          if (aiResult.horario && funcionario) {
            if (aiResult.confianca >= 90) {
              // High confidence with explicit time -> auto register with that time
              intent = aiResult.tipo;
              // Override current time with the explicit time for registration
              this._pendingExplicitTime = aiResult.horario;
              console.log(`[WhatsApp] Auto-registro com horário explícito: ${funcionario.nome} ${aiResult.tipo} às ${aiResult.horario} (confiança ${aiResult.confianca}%)`);
            } else {
              // 50-89% confidence with explicit time -> ask for confirmation
              const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
              const tipoLabel = aiResult.tipo === 'entrada' ? 'entrada' : 'saída';
              this.createPendingConfirmation(funcionario.id, aiResult.tipo, today, aiResult.horario, text);
              await this.sendGroupMessage(
                `${funcionario.nome}, deseja registrar ${tipoLabel} às ${aiResult.horario}? Responda *SIM* ou *NÃO*.`
              );
              this.storeMessage(msg.id._serialized, senderPhone, senderName, funcionario?.id || null, storedText, 'other', mediaType, mediaPath);
              return;
            }
          } else if (aiResult.confianca >= 80) {
            intent = aiResult.tipo; // High confidence -> auto register
          } else {
            // 50-79% confidence -> ask for confirmation with current time
            if (funcionario) {
              const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
              const currentTime = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
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

    // PRIORITY 1: Document detection (CRLV, RG, CPF, etc.) — runs BEFORE entregas
    if (visionAnalysis?.is_document && mediaPath) {
      try {
        const docType = visionAnalysis.document_type || 'desconhecido';
        const ext = visionAnalysis.extracted_data || {};
        const entTipo = visionAnalysis.suggested_entity || 'desconhecido';
        let matchMsg = '';

        if (entTipo === 'veiculo' && ext.placa) {
          const Veiculo = require('../models/Veiculo');
          const existing = Veiculo.findByPlaca ? Veiculo.findByPlaca(ext.placa) : null;
          if (existing) {
            matchMsg = `Veículo encontrado: ${existing.marca} ${existing.modelo} (${ext.placa})`;
          } else {
            matchMsg = `Veículo com placa *${ext.placa}* não cadastrado`;
          }
        } else if (entTipo === 'funcionario' && (ext.cpf || ext.nome)) {
          const label = ext.cpf ? `CPF ${ext.cpf}` : ext.nome;
          matchMsg = `Documento de funcionário: ${label}`;
        }

        const docData = JSON.stringify({
          type: 'documento',
          document_type: docType,
          extracted_data: ext,
          suggested_entity: entTipo,
          matched_entity: matchMsg ? true : false,
          imagem_path: mediaPath,
          descricao: visionAnalysis.descricao,
          whatsapp_mensagem_id: msgDbId
        });
        const funcId = funcionario?.id || 0;
        this.createPendingConfirmation(funcId, 'documento', new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }), '00:00', docData);
        const typeLabel = { crlv: 'CRLV', rg: 'RG', cpf: 'CPF', cnh: 'CNH', apolice: 'Apólice', ipva: 'IPVA' }[docType] || docType.toUpperCase();
        await this.sendGroupMessage(
          `📄 ${senderName}, identifiquei um documento *${typeLabel}*. ${matchMsg || ''}\nDeseja registrar? Responda *SIM* ou *NÃO*.`
        );
        console.log(`[WhatsApp] Document ${docType} detected from ${senderName}, confirmation requested`);
      } catch (err) {
        console.error('[WhatsApp] Error handling document photo:', err.message);
      }
      return; // Don't process further (prevent task/entrega creation)
    }

    // PRIORITY 2: Nota fiscal detection (cupom fiscal with items/prices)
    if (visionAnalysis?.is_nota_fiscal && mediaPath) {
      try {
        const nfData = visionAnalysis.nota_fiscal_data || {};
        const items = nfData.items || [];
        const establishment = nfData.establishment_name || 'Desconhecido';
        const total = nfData.total || 0;
        const nfDate = nfData.date || new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

        // Save items to historico_precos
        const ListaCompras = require('../models/ListaCompras');
        let savedCount = 0;
        for (const item of items) {
          if (item.name && item.unit_price) {
            try {
              ListaCompras.addPreco({
                nome_item: item.name,
                nome_normalizado: ListaCompras.normalizeName(item.name),
                preco: item.unit_price,
                estabelecimento: establishment,
                categoria: 'outro',
                fonte: 'whatsapp',
                nota_fiscal_path: mediaPath,
                data_compra: nfDate
              });
              savedCount++;
            } catch (e) { /* ignore duplicate */ }
          }
        }

        // Also create a despesa if total > 0
        if (total > 0 && funcionario) {
          const Despesa = require('../models/Despesa');
          const despId = Despesa.create({
            funcionario_id: funcionario.id,
            descricao: `Nota fiscal - ${establishment}`,
            valor: total,
            categoria: 'mercado',
            estabelecimento: establishment,
            data_despesa: nfDate,
            comprovante_path: mediaPath,
            dados_extraidos: JSON.stringify(nfData),
            fonte: 'whatsapp',
            fonte_chat: 'grupo'
          });
          console.log(`[WhatsApp] Despesa #${despId} created from nota fiscal`);
        }

        // Try to match with active lista de compras
        let matchedItems = 0;
        try {
          const listas = ListaCompras.getAllListas(false);
          const activeList = listas.find(l => l.status === 'aberta' || l.status === 'em_andamento');
          if (activeList) {
            const listItems = ListaCompras.getItens(activeList.id);
            for (const nfItem of items) {
              const normalized = ListaCompras.normalizeName(nfItem.name);
              const match = listItems.find(li => !li.comprado && ListaCompras.normalizeName(li.nome_item).includes(normalized));
              if (match && nfItem.unit_price) {
                ListaCompras.markAsBought(match.id, {
                  preco_pago: nfItem.total_price || nfItem.unit_price,
                  estabelecimento: establishment,
                  data_compra: nfDate
                });
                matchedItems++;
              }
            }
          }
        } catch (e) { console.error('[WhatsApp] List matching error:', e.message); }

        let respMsg = `🧾 Nota fiscal processada!\n📍 ${establishment}\n📅 ${nfDate}\n🛒 ${savedCount} itens extraídos`;
        if (total > 0) respMsg += ` - Total: R$ ${total.toFixed(2)}`;
        if (matchedItems > 0) respMsg += `\n✅ ${matchedItems} itens marcados na lista de compras`;
        await this.sendGroupMessage(respMsg);
        console.log(`[WhatsApp] Nota fiscal processed: ${savedCount} items from ${establishment}`);
      } catch (err) {
        console.error('[WhatsApp] Error processing nota fiscal:', err.message);
      }
      return;
    }

    // PRIORITY 3: Comprovante de pagamento (PIX, transfer receipt)
    if (visionAnalysis?.is_comprovante && mediaPath) {
      try {
        const compData = visionAnalysis.comprovante_data || {};
        const valor = compData.value || 0;
        const descricao = compData.description || 'Pagamento';
        const establishment = compData.establishment || compData.recipient || 'Desconhecido';
        const compDate = compData.date || new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

        if (valor > 0 && funcionario) {
          const Despesa = require('../models/Despesa');
          const despId = Despesa.create({
            funcionario_id: funcionario.id,
            descricao: descricao,
            valor: valor,
            categoria: 'outro',
            estabelecimento: establishment,
            data_despesa: compDate,
            comprovante_path: mediaPath,
            dados_extraidos: JSON.stringify(compData),
            fonte: 'whatsapp',
            fonte_chat: 'grupo'
          });

          await this.sendGroupMessage(
            `💸 Despesa registrada!\n📋 ${descricao}\n💰 R$ ${valor.toFixed(2)}\n📍 ${establishment}\n👤 ${funcionario.nome}\n\nAguardando aprovação do gestor.`
          );

          // Notify admin
          try {
            const admin = db.prepare("SELECT telefone FROM users WHERE role = 'admin' AND telefone IS NOT NULL LIMIT 1").get();
            if (admin && admin.telefone) {
              await this.sendPrivateMessage(admin.telefone,
                `📩 Nova despesa para aprovar:\n💸 R$ ${valor.toFixed(2)} - ${descricao}\n👤 ${funcionario.nome}\n📍 ${establishment}`
              );
            }
          } catch (e) { console.error('[WhatsApp] Admin notify error:', e.message); }

          console.log(`[WhatsApp] Despesa #${despId} created from comprovante by ${funcionario.nome}`);
        } else {
          await this.sendGroupMessage(`💸 Comprovante recebido de ${senderName}, mas não foi possível extrair o valor ou identificar o funcionário.`);
        }
      } catch (err) {
        console.error('[WhatsApp] Error processing comprovante:', err.message);
      }
      return;
    }

    // PRIORITY 4: Ask for confirmation when AI detects a delivery photo
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
        this.createPendingConfirmation(funcId, 'entrega', new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }), '00:00', entregaData);
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

    // Check if sender is a prestador (service provider) before registering ponto
    if (intent && (intent === 'entrada' || intent === 'saida') && senderPhone) {
      try {
        const Prestador = require('../models/Prestador');
        const prestador = Prestador.findByPhone(senderPhone);
        if (prestador) {
          const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
          const currentTime = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
          const timeToUse = this._pendingExplicitTime || currentTime;
          this._pendingExplicitTime = null;

          if (intent === 'entrada') {
            const existing = Prestador.getTodayVisita(prestador.id, today);
            if (existing) {
              const entradaTime = existing.data_entrada ? existing.data_entrada.split(' ')[1] || existing.data_entrada : '?';
              await this.sendGroupMessage(`${prestador.nome}, sua visita de hoje já foi registrada (entrada às ${entradaTime}).`);
            } else {
              Prestador.createVisita({ prestador_id: prestador.id, data_entrada: `${today} ${timeToUse}`, fonte: 'whatsapp' });
              await this.sendGroupMessage(`🔧 ${prestador.nome} (prestador) registrou *chegada* às ${timeToUse}. Bom trabalho!`);
              console.log(`[WhatsApp] Prestador ${prestador.nome} entrada at ${timeToUse}`);
            }
          } else {
            const existing = Prestador.getTodayVisita(prestador.id, today);
            if (existing && !existing.data_saida) {
              Prestador.updateVisita(existing.id, { data_saida: `${today} ${timeToUse}` });
              const entradaTime = existing.data_entrada ? existing.data_entrada.split(' ')[1] || existing.data_entrada : null;
              let durStr = '';
              if (entradaTime) {
                const [eH, eM] = entradaTime.split(':').map(Number);
                const [sH, sM] = timeToUse.split(':').map(Number);
                const durMin = (sH * 60 + sM) - (eH * 60 + eM);
                if (durMin > 0) durStr = `${Math.floor(durMin / 60)}h${durMin % 60 > 0 ? (durMin % 60) + 'min' : ''}`;
              }
              await this.sendGroupMessage(`🔧 ${prestador.nome} (prestador) registrou *saída* às ${timeToUse}.${durStr ? ` Duração: ${durStr}` : ''}`);
              console.log(`[WhatsApp] Prestador ${prestador.nome} saida at ${timeToUse}`);
            } else if (!existing) {
              Prestador.createVisita({ prestador_id: prestador.id, data_entrada: `${today} ${timeToUse}`, data_saida: `${today} ${timeToUse}`, fonte: 'whatsapp' });
              await this.sendGroupMessage(`🔧 ${prestador.nome} (prestador) registrou *saída* às ${timeToUse} (visita avulsa).`);
            } else {
              await this.sendGroupMessage(`${prestador.nome}, sua saída de hoje já foi registrada.`);
            }
          }
          return; // Prestador handled, skip ponto registration
        }
      } catch (e) {
        console.error('[WhatsApp] Prestador check error:', e.message);
      }
    }

    // If clock-in/out/lunch intent detected and employee found, register the punch
    if (intent && funcionario) {
      await this.registerPunch(funcionario, intent, msg, isAudioMessage);
    } else if (intent && !funcionario) {
      console.log(`[WhatsApp] Punch intent "${intent}" but could not create employee: ${senderName} (${senderPhone})`);
    } else if (!intent && text && !visionAnalysis?.is_document && !visionAnalysis?.is_nota_fiscal && !visionAnalysis?.is_comprovante && !visionAnalysis?.is_entrega) {
      // CATCH-ALL: No intent matched, no document/delivery — create suggestion
      const alphanumCount = (text.match(/[a-zA-Z0-9\u00C0-\u024F]/g) || []).length;
      if (alphanumCount >= 5) { // Only for meaningful messages (>= 5 alphanumeric chars)
        const fonteTipo = isAudioMessage ? 'audio' : 'texto';
        const suggestion = await this.createSuggestion(
          text, senderName, senderPhone, fonteTipo,
          mediaType === 'image' ? mediaPath : null,
          isAudioMessage ? audioFilePath : null,
          audioTranscription, msgDbId
        );
        if (suggestion) {
          const prioridadeEmoji = { alta: '🔴', media: '🟡', baixa: '🟢' };
          const responseText = `💡 Sugestão #${suggestion.id}:\n📋 ${suggestion.titulo}\n📝 ${suggestion.descricao}\n🏷️ Prioridade: ${prioridadeEmoji[suggestion.prioridade] || '🟡'} ${suggestion.prioridade}\n\nCriar como tarefa? Responda *SIM* ou *NÃO*.`;
          // Create pending confirmation for suggestion->task conversion
          this.createPendingConfirmation(
            funcionario?.id || 0,
            'sugestao',
            new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }),
            '00:00',
            JSON.stringify({ sugestao_id: suggestion.id, titulo: suggestion.titulo, descricao: suggestion.descricao, prioridade: suggestion.prioridade })
          );
          // Send suggestion to admin privately (not to group)
          const adminUser = db.prepare("SELECT telefone FROM users WHERE role = 'admin' AND telefone IS NOT NULL ORDER BY id LIMIT 1").get();
          if (adminUser && adminUser.telefone) {
            await this.sendPrivateMessage(adminUser.telefone, responseText);
          }
        }
      }
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
      const client = this._getAnthropicClient();

      const now = new Date();
      const currentTime = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
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
      const createConfirmation = db.transaction(() => {
        // Cancel any existing pending for this employee
        db.prepare(
          "UPDATE pending_confirmations SET status = 'expired', resolved_at = datetime('now','localtime') WHERE funcionario_id = ? AND status = 'pending'"
        ).run(funcionarioId);

        const result = db.prepare(
          'INSERT INTO pending_confirmations (funcionario_id, tipo, data, horario, message_text) VALUES (?, ?, ?, ?, ?)'
        ).run(funcionarioId, tipo, data, horario, messageText || null);
        return result.lastInsertRowid;
      });
      return createConfirmation();
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
    // Throttle: run at most once every 5 minutes
    const now = Date.now();
    if (this._lastExpireRun && now - this._lastExpireRun < 5 * 60 * 1000) return;
    this._lastExpireRun = now;
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
    const funcionarios = this._getFuncionarios();

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

  async registerPunch(funcionario, intent, msg, isAudioMessage = false) {
    const now = new Date();
    // If this is a missed message, use the original timestamp
    const effectiveTime = msg._originalTimestamp || now;
    const today = effectiveTime.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }); // YYYY-MM-DD
    // Use explicit time from AI if available (e.g., "cheguei às 8:30" with high confidence)
    let currentTime;
    if (this._pendingExplicitTime) {
      currentTime = this._pendingExplicitTime;
      this._pendingExplicitTime = null;
    } else {
      currentTime = effectiveTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }); // HH:MM
    }

    // For missed messages: ask confirmation (unless autoRegister mode)
    if (msg._isMissed && !msg._autoRegister) {
      const tipoLabel = intent === 'entrada' ? 'entrada' : intent === 'saida' ? 'saída' : intent === 'saida_almoco' ? 'saída almoço' : intent === 'retorno_almoco' ? 'retorno almoço' : intent;
      this.createPendingConfirmation(funcionario.id, intent, today, currentTime, msg.body || '');
      await this.sendGroupMessage(
        `⏰ ${funcionario.nome}, o bot estava offline quando você enviou "${(msg.body || '').substring(0, 50)}". Deseja registrar *${tipoLabel}* às *${currentTime}* (${today})? Responda *SIM* ou *NÃO*.`
      );
      console.log(`[WhatsApp] Missed punch confirmation requested: ${funcionario.nome} ${intent} at ${currentTime} (${today})`);
      return;
    }

    // Helper: send response (audio if original was audio, text otherwise)
    const notify = async (text) => {
      if (msg._silent) return;
      if (isAudioMessage && process.env.ELEVENLABS_API_KEY) {
        await this.sendAudioResponse(msg, text);
      } else {
        await this.sendGroupMessage(text);
      }
    };

    try {
      if (intent === 'entrada') {
        // Check if already has an entrada today
        const existing = db.prepare(
          'SELECT id FROM registros WHERE funcionario_id = ? AND data = ? AND entrada IS NOT NULL'
        ).get(funcionario.id, today);

        if (existing) {
          console.log(`[WhatsApp] Entrada already exists: ${funcionario.nome} ${today} (skipped)`);
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
        await notify(`Entrada registrada para ${funcionario.nome} - ${currentTime}`);

      } else if (intent === 'saida') {
        // Find today's registro without saida
        const openRecord = db.prepare(
          'SELECT id FROM registros WHERE funcionario_id = ? AND data = ? AND entrada IS NOT NULL AND saida IS NULL'
        ).get(funcionario.id, today);

        if (openRecord) {
          // Update existing record with saida
          Registro.update(openRecord.id, { saida: currentTime }, null);
          console.log(`[WhatsApp] Saida registered: ${funcionario.nome} at ${currentTime}`);
          await notify(`Saida registrada para ${funcionario.nome} - ${currentTime}`);
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
          await notify(`Saida registrada para ${funcionario.nome} - ${currentTime} (sem entrada registrada hoje)`);
        }
      } else if (intent === 'saida_almoco') {
        // Check if already has a saida_almoco today
        const existingAlmoco = db.prepare(
          "SELECT id FROM registros WHERE funcionario_id = ? AND data = ? AND saida IS NOT NULL AND entrada IS NULL AND observacao LIKE '%saída almoço%'"
        ).get(funcionario.id, today);

        if (existingAlmoco) {
          console.log(`[WhatsApp] Saida almoco already exists: ${funcionario.nome} ${today} (skipped)`);
          return;
        }

        Registro.create({
          funcionario_id: funcionario.id,
          data: today,
          entrada: null,
          saida: currentTime,
          tipo: 'whatsapp',
          observacao: `Via WhatsApp (saída almoço): "${msg.body.trim().substring(0, 100)}"`,
        });

        console.log(`[WhatsApp] Saida almoco registered: ${funcionario.nome} at ${currentTime}`);
        await notify(`Saída para almoço registrada para ${funcionario.nome} - ${currentTime}`);

      } else if (intent === 'retorno_almoco') {
        // Check if already has a retorno_almoco today
        const existingRetorno = db.prepare(
          "SELECT id FROM registros WHERE funcionario_id = ? AND data = ? AND entrada IS NOT NULL AND saida IS NULL AND observacao LIKE '%retorno almoço%'"
        ).get(funcionario.id, today);

        if (existingRetorno) {
          console.log(`[WhatsApp] Retorno almoco already exists: ${funcionario.nome} ${today} (skipped)`);
          return;
        }

        Registro.create({
          funcionario_id: funcionario.id,
          data: today,
          entrada: currentTime,
          saida: null,
          tipo: 'whatsapp',
          observacao: `Via WhatsApp (retorno almoço): "${msg.body.trim().substring(0, 100)}"`,
        });

        console.log(`[WhatsApp] Retorno almoco registered: ${funcionario.nome} at ${currentTime}`);
        await notify(`Retorno do almoço registrado para ${funcionario.nome} - ${currentTime}`);
      }
    } catch (err) {
      if (err.message.includes('Ja existe') || err.message.includes('Já existe')) {
        await notify(
          `${funcionario.nome}, esse horario ja foi registrado hoje.`
        );
      } else {
        console.error(`[WhatsApp] Error registering punch for ${funcionario.nome}:`, err.message);
      }
    }
  }

  async analyzeImage(base64Data, mimetype, senderName, captionText) {
    try {
      const client = this._getAnthropicClient();

      const prompt = `Analise esta foto enviada por "${senderName}" no grupo de trabalho da residência "Lar Digital".
${captionText ? `Legenda da foto: "${captionText}"` : 'Sem legenda.'}

Descreva brevemente o que aparece na foto em 2-3 frases curtas, em português.

PRIORIDADE DE CLASSIFICAÇÃO (nesta ordem EXATA):
1. DOCUMENTO: Se é um documento brasileiro (CRLV, RG, CPF, CNH, apólice de seguro, IPVA, comprovante de endereço, contrato, holerite), extraia TODOS os dados legíveis.
2. NOTA FISCAL: Se é um cupom fiscal, nota fiscal, recibo de compra COM ITENS e preços (tem CNPJ, lista de produtos, valores). NÃO é documento pessoal.
3. COMPROVANTE: Se é um comprovante de pagamento PIX, transferência bancária, recibo de pagamento (tem valor, destinatário, banco). NÃO tem lista de itens.
4. ENTREGA: Se é um pacote, encomenda, caixa, correspondência ou similar.
5. OUTRO: Foto casual, selfie, serviço realizado, etc.

Ao final, inclua um bloco JSON:
\`\`\`json
{"classification": "DOCUMENTO|NOTA_FISCAL|COMPROVANTE|ENTREGA|OUTRO", "is_document": true/false, "document_type": "crlv|rg|cpf|cnh|apolice|ipva|comprovante_endereco|contrato|holerite|outro", "extracted_data": {"placa": "", "marca": "", "modelo": "", "ano": "", "renavam": "", "chassi": "", "cor": "", "combustivel": "", "cpf": "", "nome": "", "rg": "", "data_nascimento": ""}, "suggested_entity": "veiculo|funcionario", "is_nota_fiscal": true/false, "nota_fiscal_data": {"items": [{"name": "", "quantity": 1, "unit_price": 0, "total_price": 0}], "establishment_name": "", "cnpj": "", "total": 0, "date": ""}, "is_comprovante": true/false, "comprovante_data": {"value": 0, "date": "", "recipient": "", "description": "", "establishment": ""}, "is_entrega": true/false, "destinatario": "nome ou null", "remetente": "empresa ou null", "transportadora": "empresa ou null"}
\`\`\`
- classification: tipo principal (DOCUMENTO, NOTA_FISCAL, COMPROVANTE, ENTREGA, OUTRO)
- is_document: true se for documento oficial (CRLV, RG, CPF, CNH, apólice, IPVA, etc.)
- is_nota_fiscal: true se for cupom/nota fiscal COM lista de itens e preços
- is_comprovante: true se for comprovante PIX/transferência/pagamento SEM lista de itens
- is_entrega: true SOMENTE se for pacote/encomenda
- MUTUAMENTE EXCLUSIVOS: apenas UM dos is_ pode ser true por vez`;

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
      let structured = { is_document: false, is_nota_fiscal: false, is_comprovante: false, is_entrega: false, destinatario: null, remetente: null, transportadora: null };
      try {
        const jsonMatch = analysis.match(/```json\s*([\s\S]*?)```/) || analysis.match(/(\{[\s\S]*?"(?:is_|classification)[\s\S]*?\})/);
        if (jsonMatch) {
          structured = JSON.parse(jsonMatch[1].trim());
        }
      } catch (parseErr) {
        console.log('[WhatsApp] Vision JSON parse fallback, using defaults');
      }

      // Extract description text (everything before the JSON block)
      let descricao = analysis.replace(/```json[\s\S]*?```/, '').trim();
      if (!descricao) descricao = analysis;

      // Ensure mutual exclusivity based on classification
      const cls = (structured.classification || '').toUpperCase();
      const isDoc = cls === 'DOCUMENTO' || !!structured.is_document;
      const isNota = cls === 'NOTA_FISCAL' || (!!structured.is_nota_fiscal && !isDoc);
      const isComprovante = cls === 'COMPROVANTE' || (!!structured.is_comprovante && !isDoc && !isNota);
      const isEntrega = cls === 'ENTREGA' || (!!structured.is_entrega && !isDoc && !isNota && !isComprovante);

      return {
        descricao,
        classification: cls || 'OUTRO',
        is_document: isDoc,
        document_type: structured.document_type || null,
        extracted_data: structured.extracted_data || null,
        suggested_entity: structured.suggested_entity || null,
        is_nota_fiscal: isNota,
        nota_fiscal_data: structured.nota_fiscal_data || null,
        is_comprovante: isComprovante,
        comprovante_data: structured.comprovante_data || null,
        is_entrega: isEntrega,
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

      console.log(`[WhatsApp] Private message: type=${msg.type} from=${senderName} (${senderPhone}) hasMedia=${msg.hasMedia} body="${text.substring(0, 50)}"`);

      // Find matching user by phone
      const user = db.prepare("SELECT * FROM users WHERE telefone IS NOT NULL AND telefone != '' AND ? LIKE '%' || REPLACE(REPLACE(REPLACE(telefone, '(', ''), ')', ''), '-', '') || '%'").get(senderPhone);

      // Find matching funcionario for chat storage
      const func = this.matchEmployee(senderPhone, senderName);

      // Download media once for reuse across chat storage and document detection
      let _downloadedMedia = null;
      let mediaPath = null;
      if (msg.hasMedia) {
        try {
          _downloadedMedia = await Promise.race([
            msg.downloadMedia(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Media download timeout (30s)')), 30000))
          ]);
        } catch (e) {
          console.error('[WhatsApp] Private media download error:', e.message);
        }
      }

      // Store as chat message if we can match a funcionario
      if (func) {
        let tipo = 'texto';
        if (_downloadedMedia) {
          try {
            const fs = require('fs');
            const path = require('path');
            const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'chat');
            fs.mkdirSync(uploadDir, { recursive: true });
            const ext = _downloadedMedia.mimetype.split('/')[1]?.split(';')[0] || 'bin';
            const filename = `recv-${func.id}-${Date.now()}.${ext}`;
            fs.writeFileSync(path.join(uploadDir, filename), Buffer.from(_downloadedMedia.data, 'base64'));
            mediaPath = `/uploads/chat/${filename}`;
            tipo = _downloadedMedia.mimetype.startsWith('image') ? 'foto' : _downloadedMedia.mimetype.startsWith('audio') ? 'audio' : 'arquivo';
          } catch (e) {
            console.error('[WhatsApp] Private media save error:', e.message);
          }
        }
        db.prepare(`
          INSERT INTO whatsapp_chats (funcionario_id, direcao, tipo, conteudo, media_path)
          VALUES (?, 'recebida', ?, ?, ?)
        `).run(func.id, tipo, text || '', mediaPath);
      }

      // Document detection for admin users with images (runs BEFORE task creation)
      let _isDocumentDetected = false;
      let _imageAnalyzedForDocs = false;
      if (user && user.role === 'admin' && _downloadedMedia) {
        _imageAnalyzedForDocs = true; // Block task creation from this image regardless of outcome
        try {
          const media = _downloadedMedia;
          if (media && media.mimetype.startsWith('image')) {
            // Check if there's a pending document confirmation for this chat
            const chatId = msg.from;
            const pendingDoc = db.prepare("SELECT * FROM pending_confirmations WHERE tipo = 'documento_upload' AND whatsapp_chat_id = ? AND status = 'pending' AND created_at > datetime('now','localtime','-5 minutes')").get(chatId);
            if (!pendingDoc) {
              // Analyze document with Vision AI
              if (process.env.ANTHROPIC_API_KEY) {
                const client = this._getAnthropicClient();
                const resp = await client.messages.create({
                  model: 'claude-haiku-4-5-20251001',
                  max_tokens: 1500,
                  messages: [{ role: 'user', content: [
                    { type: 'image', source: { type: 'base64', media_type: media.mimetype, data: media.data } },
                    { type: 'text', text: `Analise esta imagem. É um DOCUMENTO (CRLV, RG, CPF, CNH, comprovante, apólice, contrato, holerite)?
Se SIM, retorne JSON: {"is_document": true, "type": "crlv|rg|cpf|cnh|comprovante_endereco|apolice_seguro|contrato|holerite|outro", "description": "descrição curta", "extracted_data": {...}, "suggested_entity": "funcionario|veiculo"}
Se NÃO (foto casual, selfie, etc), retorne: {"is_document": false}
Retorne APENAS JSON válido.` }
                  ]}]
                });
                const docText = resp.content[0]?.text?.trim() || '';
                const docCleaned = docText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
                let docResult;
                try { docResult = JSON.parse(docCleaned); } catch (e) {
                  const m = docCleaned.match(/\{[\s\S]*\}/);
                  if (m) docResult = JSON.parse(m[0]);
                }

                if (docResult && docResult.is_document) {
                  _isDocumentDetected = true;
                  // Save the image
                  const docDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'documentos', 'avulsos');
                  fs.mkdirSync(docDir, { recursive: true });
                  const ext = media.mimetype.split('/')[1]?.split(';')[0] || 'jpg';
                  const filename = `${docResult.type || 'doc'}_${Date.now()}.${ext}`;
                  fs.writeFileSync(path.join(docDir, filename), Buffer.from(media.data, 'base64'));

                  // Try matching entities
                  const extData = docResult.extracted_data || {};
                  let matchInfo = '';
                  let matchedEntity = null;
                  if (extData.cpf) {
                    const cpfClean = String(extData.cpf).replace(/\D/g, '');
                    const matched = db.prepare("SELECT id, nome FROM funcionarios WHERE cpf = ? AND status = 'ativo'").get(cpfClean);
                    if (matched) { matchInfo = `\n👤 Funcionário: ${matched.nome}`; matchedEntity = { tipo: 'funcionario', id: matched.id }; }
                  }
                  if (extData.placa && !matchedEntity) {
                    const placaClean = String(extData.placa).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                    const matched = db.prepare("SELECT id, marca, modelo, placa FROM veiculos WHERE REPLACE(UPPER(placa), '-', '') = ? AND status = 'ativo'").get(placaClean);
                    if (matched) { matchInfo = `\n🚗 Veículo: ${matched.marca} ${matched.modelo} - ${matched.placa}`; matchedEntity = { tipo: 'veiculo', id: matched.id }; }
                  }

                  const Documento = require('../models/Documento');
                  const typeLabels = { crlv: 'CRLV', rg: 'RG', cpf: 'CPF', cnh: 'CNH', comprovante_endereco: 'Comprovante de Endereço', apolice_seguro: 'Apólice de Seguro', contrato: 'Contrato', holerite: 'Holerite', outro: 'Outro' };
                  const typeLabel = typeLabels[docResult.type] || docResult.type;

                  // Create pending confirmation
                  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
                  const suggestedType = docResult.suggested_entity || (extData.placa ? 'veiculo' : 'funcionario');
                  db.prepare(`INSERT INTO pending_confirmations (tipo, funcionario_id, data, horario, message_text, status, whatsapp_chat_id, created_at) VALUES ('documento_upload', NULL, ?, '00:00', ?, 'pending', ?, datetime('now','localtime'))`).run(
                    today,
                    JSON.stringify({
                      doc_type: docResult.type,
                      description: docResult.description,
                      extracted_data: docResult.extracted_data,
                      arquivo_path: `/uploads/documentos/avulsos/${filename}`,
                      matched_entity: matchedEntity,
                      suggested_entity: suggestedType
                    }),
                    chatId
                  );

                  let replyMsg = `📄 Documento identificado: *${typeLabel}*`;
                  if (docResult.description) replyMsg += `\n📝 ${docResult.description}`;
                  replyMsg += matchInfo;
                  if (matchedEntity) {
                    replyMsg += `\n✅ ${matchedEntity.tipo === 'funcionario' ? 'Funcionário' : 'Veículo'} encontrado no sistema`;
                  } else {
                    const suggestedType = docResult.suggested_entity || (extData.placa ? 'veiculo' : 'funcionario');
                    if (suggestedType === 'veiculo' && extData.placa) {
                      replyMsg += `\n⚠️ Veículo com placa ${extData.placa} não encontrado`;
                      replyMsg += `\n🆕 Um novo veículo será criado ao confirmar`;
                    } else if (extData.cpf) {
                      replyMsg += `\n⚠️ Funcionário com CPF não encontrado`;
                      replyMsg += `\n🆕 Um novo funcionário será criado ao confirmar`;
                    } else {
                      replyMsg += `\n⚠️ Nenhuma entidade correspondente encontrada`;
                      replyMsg += `\n📁 Documento será salvo como avulso`;
                    }
                  }
                  replyMsg += `\n\nDeseja salvar este documento? (Sim/Não)`;
                  await msg.reply(replyMsg);
                  console.log(`[WhatsApp] Document detected in private: ${docResult.type} from ${senderName}`);
                  return;
                } else {
                  // Not a document — analyze image and respond conversationally
                  console.log(`[WhatsApp] Image from ${senderName} is NOT a document, analyzing for suggestions`);
                  try {
                    const allFuncs = this._getFuncionarios();
                    const funcNames = allFuncs.map(f => f.nome).join(', ');
                    const today = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                    const respSuggestion = await client.messages.create({
                      model: 'claude-haiku-4-5-20251001',
                      max_tokens: 500,
                      messages: [{ role: 'user', content: [
                        { type: 'image', source: { type: 'base64', media_type: media.mimetype, data: media.data } },
                        { type: 'text', text: `Você é a assistente virtual do Lar Digital, chamada Lia. Seja sempre simpática, acolhedora e prestativa. Analise esta foto enviada pelo administrador da casa.
Funcionários disponíveis: ${funcNames}. Hoje: ${today}.

Descreva o que vê na foto de forma natural e amigável. Depois, sugira o que pode fazer para ajudar:
- Criar tarefa para um funcionário
- Registrar item no estoque
- Agendar manutenção/revisão
- Qualquer outra ação relevante

SEMPRE termine perguntando se precisa de algo mais ou se quer que você tome alguma ação. Seja calorosa mas concisa.
Use emojis com moderação. Responda em português brasileiro.
Exemplo de tom: "Que lindo! Vi que é... Posso criar uma tarefa para... ou registrar no estoque. O que prefere? Precisa de mais alguma coisa? 😊"` }
                      ]}]
                    });
                    const suggestion = respSuggestion.content[0]?.text || '';
                    if (suggestion) {
                      this._addToMemory(msg.from, 'user', '[Foto enviada: ' + (suggestion.substring(0, 100)) + '...]');
                      this._addToMemory(msg.from, 'assistant', suggestion);
                      await msg.reply(suggestion);
                      console.log(`[WhatsApp] Image suggestion sent to ${senderName}`);
                    }
                  } catch (sugErr) {
                    console.error('[WhatsApp] Image suggestion error:', sugErr.message);
                  }
                  return;
                }
              }
            }
          }
        } catch (docErr) {
          console.error('[WhatsApp] Document detection error (task creation blocked for this image):', docErr.message);
        }
      }

      // Handle document confirmation responses (Sim/Não)
      if (user && text && /^(sim|não|nao|s|n)$/i.test(text.trim())) {
        const chatId = msg.from;
        const pendingDoc = db.prepare("SELECT * FROM pending_confirmations WHERE tipo = 'documento_upload' AND whatsapp_chat_id = ? AND status = 'pending' AND created_at > datetime('now','localtime','-5 minutes') ORDER BY created_at DESC LIMIT 1").get(chatId);
        if (pendingDoc) {
          const isYes = /^(sim|s)$/i.test(text.trim());
          if (isYes) {
            const docData = JSON.parse(pendingDoc.message_text);
            const Documento = require('../models/Documento');
            let entTipo = docData.matched_entity ? docData.matched_entity.tipo : (docData.suggested_entity || 'funcionario');
            let entId = docData.matched_entity ? docData.matched_entity.id : 0;
            let createdMsg = '';

            // If no entity matched, CREATE one from extracted data
            if (!docData.matched_entity && docData.extracted_data) {
              const ext = docData.extracted_data;
              try {
                if (entTipo === 'veiculo' && ext.placa) {
                  const Veiculo = require('../models/Veiculo');
                  const newId = Veiculo.create({
                    placa: String(ext.placa).replace(/[^a-zA-Z0-9]/g, '').toUpperCase(),
                    marca: ext.marca || ext.fabricante || '',
                    modelo: ext.modelo || '',
                    ano_fabricacao: ext.ano_fabricacao || ext.ano || null,
                    ano_modelo: ext.ano_modelo || ext.ano || null,
                    cor: ext.cor || '',
                    renavam: ext.renavam || '',
                    chassi: ext.chassi || '',
                    combustivel: ext.combustivel || 'flex'
                  });
                  entId = newId;
                  createdMsg = `\n🆕 Veículo criado: ${ext.placa}`;
                  console.log(`[WhatsApp] Created vehicle from document: ${ext.placa} id=${newId}`);
                } else if (entTipo === 'funcionario' && (ext.cpf || ext.nome)) {
                  const Funcionario = require('../models/Funcionario');
                  const cpfClean = ext.cpf ? String(ext.cpf).replace(/\D/g, '') : '';
                  const newId = Funcionario.create({
                    nome: ext.nome || 'Funcionário (via documento)',
                    cpf: cpfClean || null,
                    rg: ext.rg || null,
                    data_nascimento: ext.data_nascimento || null
                  });
                  entId = newId;
                  createdMsg = `\n🆕 Funcionário criado: ${ext.nome || cpfClean}`;
                  console.log(`[WhatsApp] Created employee from document: ${ext.nome || cpfClean} id=${newId}`);
                }
              } catch (createErr) {
                console.error('[WhatsApp] Error creating entity from document:', createErr.message);
              }
            }

            // Move file to proper directory if entity resolved
            if (entId > 0) {
              const subdir = entTipo === 'funcionario' ? 'funcionarios' : 'veiculos';
              const newDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'documentos', subdir, String(entId));
              fs.mkdirSync(newDir, { recursive: true });
              const oldPath = path.join(__dirname, '..', '..', 'public', docData.arquivo_path);
              const basename = path.basename(docData.arquivo_path);
              const newPath = path.join(newDir, basename);
              try { fs.renameSync(oldPath, newPath); } catch (e) { /* keep in avulsos */ }
              docData.arquivo_path = `/uploads/documentos/${subdir}/${entId}/${basename}`;
            }

            Documento.create({
              tipo: docData.doc_type,
              descricao: docData.description,
              entidade_tipo: entTipo,
              entidade_id: entId,
              arquivo_path: docData.arquivo_path,
              dados_extraidos: docData.extracted_data,
              enviado_por_whatsapp: 1,
              whatsapp_mensagem_id: msg.id?._serialized || null
            });
            db.prepare("UPDATE pending_confirmations SET status = 'confirmed' WHERE id = ?").run(pendingDoc.id);
            await msg.reply('✅ Documento salvo com sucesso!' + createdMsg);
            console.log(`[WhatsApp] Document saved: ${docData.doc_type} from ${senderName}`);
          } else {
            db.prepare("UPDATE pending_confirmations SET status = 'rejected' WHERE id = ?").run(pendingDoc.id);
            await msg.reply('❌ Documento ignorado.');
          }
          return;
        }
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

      // Never create tasks from confirmation words or casual responses
      if (text && /^(sim|não|nao|s|n)$/i.test(text.trim())) return;
      if (text && /^(n[aã]o\s+obrigad[oa]|obrigad[oa]|valeu|ok|beleza|blz|tá|ta|entendi|show|perfeito|legal|boa|top|tranquilo|certo|pode ser|tá bom|ta bom|ótimo|otimo|massa)[\s!.]*$/i.test(text.trim())) {
        this._addToMemory(msg.from, 'user', text);
        return;
      }

      // Process task creation via AI
      if (!text && !msg.hasMedia) return;

      // Save user message to conversation memory
      if (text) {
        this._addToMemory(msg.from, 'user', text);
      }

      let taskContent = text;
      let fonte = 'whatsapp_texto';

      // Handle audio: transcribe with ElevenLabs STT
      const isAudioMsg = msg.type === 'audio' || msg.type === 'ptt';
      if (isAudioMsg || (msg.hasMedia && !text)) {
        const media = _downloadedMedia || await msg.downloadMedia().catch(() => null);
        if ((isAudioMsg) || (media && media.mimetype.startsWith('audio'))) {
          // Try ElevenLabs transcription
          if (process.env.ELEVENLABS_API_KEY) {
            const transcription = await this.transcribeAudio(msg);
            if (transcription && transcription.text) {
              taskContent = transcription.text;
              fonte = 'whatsapp_audio';
              this._addToMemory(msg.from, 'user', '[Áudio: ' + taskContent + ']');
              console.log(`[WhatsApp] Private audio transcribed from ${senderName}: "${taskContent.substring(0, 80)}"`);
            } else {
              return; // Transcription failed, error already sent
            }
          } else {
            // Fallback: ask for text
            if (media) {
              const audioDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'whatsapp', 'audios');
              fs.mkdirSync(audioDir, { recursive: true });
              const ext = media.mimetype.split('/')[1]?.split(';')[0] || 'ogg';
              const audioFilename = `${Date.now()}-${senderPhone}.${ext}`;
              fs.writeFileSync(path.join(audioDir, audioFilename), Buffer.from(media.data, 'base64'));
              console.log(`[WhatsApp] Audio saved: /uploads/whatsapp/audios/${audioFilename}`);
            }
            await msg.reply('🎤 Recebi seu áudio! Infelizmente ainda não consigo transcrever áudios automaticamente.\n\nPor favor, envie como *texto* para eu criar a tarefa.');
            return;
          }
        } else if (media && media.mimetype.startsWith('image') && !_imageAnalyzedForDocs) {
          fonte = 'whatsapp_foto';
          // Use Vision API if available (only if doc detection was NOT already attempted)
          if (process.env.ANTHROPIC_API_KEY && media) {
            try {
              const client = this._getAnthropicClient();
              const resp = await client.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 300,
                messages: [{ role: 'user', content: [
                  { type: 'image', source: { type: 'base64', media_type: media.mimetype, data: media.data } },
                  { type: 'text', text: 'Descreva brevemente esta imagem em português para criar uma tarefa. Máx 1 frase.' }
                ]}]
              });
              taskContent = resp.content[0]?.text || 'Tarefa com foto';
              this._addToMemory(msg.from, 'user', '[Foto: ' + taskContent + ']');
            } catch (e) {
              taskContent = 'Tarefa com foto anexada';
              this._addToMemory(msg.from, 'user', '[Foto enviada]');
            }
          } else {
            taskContent = 'Tarefa com foto anexada';
            this._addToMemory(msg.from, 'user', '[Foto enviada]');
          }
        }
      }

      if (!taskContent || taskContent.length < 3) return;

      // Use AI to parse the task
      if (!process.env.ANTHROPIC_API_KEY) {
        await msg.reply('API de IA não configurada. Não é possível interpretar tarefas.');
        return;
      }

      const allFuncionarios = this._getFuncionarios();
      const funcNames = allFuncionarios.map(f => f.nome).join(', ');

      // Build conversation context from memory
      const memory = this._getMemory(msg.from);
      let conversationContext = '';
      if (memory.length > 0) {
        const memoryLines = memory.slice(0, -1).map(m => {
          const label = m.role === 'user' ? 'Usuário' : 'Assistente';
          return `${label}: ${m.content}`;
        });
        if (memoryLines.length > 0) {
          conversationContext = `\n\nContexto da conversa recente:\n${memoryLines.join('\n')}\n`;
        }
      }

      const client = this._getAnthropicClient();
      const resp = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: `Você é a Lia, assistente virtual do Lar Digital. Seja sempre simpática, acolhedora e prestativa. Analise a mensagem e decida se é um pedido de tarefa ou uma conversa.

Funcionários disponíveis: ${funcNames}.
Hoje é ${new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })}.${conversationContext}

Mensagem atual: "${taskContent}"

REGRAS:
- Se é pedido claro de tarefa/ação (ex: "limpa a piscina", "pede pro Roberto consertar", "cria tarefa"), retorne JSON de tarefa.
- Se NÃO é pedido de ação (conversa casual, agradecimento, recusa, pergunta, comentário), retorne JSON de conversa.
- Na resposta conversacional, seja calorosa e sempre pergunte se precisa de mais alguma coisa. Use emojis com moderação.
- Use o contexto da conversa (se houver) para dar continuidade natural ao assunto.
- Exemplo de tom: "Entendido! 😊 Se precisar de qualquer coisa, é só me chamar!"

Retorne APENAS JSON válido (sem markdown):
Para tarefa: {"is_task": true, "titulo": "título curto", "descricao": "descrição detalhada ou null", "funcionario": "nome ou null", "prazo": "YYYY-MM-DD ou null", "prioridade": "alta|media|baixa"}
Para conversa: {"is_task": false, "reply": "resposta acolhedora com pergunta se precisa de algo mais"}` }]
      });

      let parsed;
      try {
        const raw = resp.content[0]?.text || '';
        const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        parsed = JSON.parse(cleaned);
      } catch (e) {
        await msg.reply('Não consegui interpretar a mensagem. Tente ser mais específico.');
        return;
      }

      // Handle conversational (non-task) responses
      if (parsed.is_task === false) {
        const reply = parsed.reply || '';
        if (reply) {
          if (isAudioMsg && process.env.ELEVENLABS_API_KEY) {
            await this.sendAudioResponse(msg, reply);
          } else {
            await msg.reply(reply);
          }
          this._addToMemory(msg.from, 'assistant', reply);
          console.log(`[WhatsApp] Conversational reply to ${senderName}: ${reply.substring(0, 50)}...`);
        }
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
      const taskReply = `✅ Tarefa #${tarefaId} criada:\n📋 ${parsed.titulo}\n👤 ${funcLabel}\n📅 ${prazoLabel}`;
      await msg.reply(taskReply);

      // Save bot response to memory
      this._addToMemory(msg.from, 'assistant', taskReply);

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

  async fetchMissedMessages(limit = 100, { autoRegister = false } = {}) {
    if (!this.ready || !this.groupChat) {
      return { success: false, error: 'WhatsApp não conectado ou grupo não encontrado.' };
    }

    const mode = autoRegister ? 'AUTO-REGISTER' : 'CONFIRMATION';
    console.log(`[WhatsApp] Buscando últimas ${limit} mensagens do grupo (modo: ${mode})...`);
    const results = { success: true, total: 0, processed: 0, skipped: 0, errors: 0, registered: 0, details: [] };

    try {
      const messages = await this.groupChat.fetchMessages({ limit });
      results.total = messages.length;
      console.log(`[WhatsApp] ${messages.length} mensagens encontradas no histórico.`);

      for (const msg of messages) {
        try {
          // Skip bot's own messages
          if (msg.fromMe) {
            results.skipped++;
            continue;
          }

          // Check if already processed (stored in DB)
          const existing = db.prepare('SELECT id FROM whatsapp_mensagens WHERE message_id = ?').get(msg.id._serialized);
          if (existing) {
            results.skipped++;
            continue;
          }

          // Extract original timestamp from the message
          const msgTimestamp = msg.timestamp ? new Date(msg.timestamp * 1000) : null;
          if (msgTimestamp) {
            // Tag the message with original time so registerPunch uses it
            msg._originalTimestamp = msgTimestamp;
            if (autoRegister) {
              // Auto-register: skip confirmation, suppress group messages
              msg._autoRegister = true;
              msg._silent = true;
            } else {
              msg._isMissed = true;
            }
          }

          // Process this missed message
          const msgTime = msgTimestamp ? msgTimestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '?';
          console.log(`[WhatsApp] Processando mensagem perdida: type=${msg.type} body="${(msg.body || '').substring(0, 40)}" hora_original=${msgTime}`);
          await this.onMessage(msg);
          results.processed++;
          results.details.push({
            id: msg.id._serialized,
            body: (msg.body || '').substring(0, 80),
            timestamp: msg.timestamp,
            originalTime: msgTime,
            type: msg.type
          });
        } catch (err) {
          console.error(`[WhatsApp] Erro ao processar mensagem perdida:`, err.message);
          results.errors++;
        }
      }

      console.log(`[WhatsApp] Fetch concluído: ${results.processed} processadas, ${results.skipped} já existentes, ${results.errors} erros.`);
      return { success: true, ...results };
    } catch (err) {
      console.error('[WhatsApp] Erro ao buscar mensagens:', err.message);
      return { success: false, error: err.message };
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

  /**
   * Send response as audio + text when original message was audio
   * Falls back to text-only if TTS fails
   */
  async sendAudioResponse(msg, text) {
    try {
      const audioPath = await elevenlabs.synthesize(text);
      const media = MessageMedia.fromFilePath(audioPath);
      await msg.reply(media);
      // Also send text for accessibility
      await msg.reply(text);
      // Cleanup temp file
      try { fs.unlinkSync(audioPath); } catch (e) { /* ignore */ }
      // Audit log
      try {
        db.prepare(`INSERT INTO audit_log (user_id, acao, detalhes, ip, created_at)
          VALUES (NULL, 'whatsapp_audio', ?, NULL, datetime('now','localtime'))`)
          .run(JSON.stringify({ direction: 'sent', text: text.substring(0, 200) }));
      } catch (e) { /* ignore */ }
    } catch (err) {
      console.error('[WhatsApp Audio TTS] Error:', err.message);
      // Fallback to text only
      await msg.reply(text);
    }
  }

  /**
   * Send a private (DM) message to a phone number
   * @param {string} phone - Phone number (just digits, with or without 55 prefix)
   * @param {string} text - Message text
   * @returns {boolean}
   */
  async sendPrivateMessage(phone, text) {
    if (!this.ready || !this.client) {
      console.log('[WhatsApp] Cannot send private message - not connected.');
      return false;
    }
    try {
      const cleanPhone = phone.replace(/\D/g, '');
      const chatId = cleanPhone.startsWith('55') ? cleanPhone + '@c.us' : '55' + cleanPhone + '@c.us';
      await this.client.sendMessage(chatId, text);
      return true;
    } catch (err) {
      console.error('[WhatsApp] Error sending private message:', err.message);
      return false;
    }
  }

  /**
   * Transcribe audio message using ElevenLabs STT
   * @returns {Promise<{text: string, duration: number|null, audioPath: string}|null>}
   */
  async transcribeAudio(msg) {
    try {
      const media = await msg.downloadMedia().catch(() => null);
      if (!media) return null;

      // Save audio to temp file
      const ext = media.mimetype.split('/')[1]?.split(';')[0] || 'ogg';
      const audioDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'whatsapp', 'audios');
      fs.mkdirSync(audioDir, { recursive: true });
      const audioFilename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const audioPath = path.join(audioDir, audioFilename);
      fs.writeFileSync(audioPath, Buffer.from(media.data, 'base64'));
      console.log(`[WhatsApp Audio] Saved: /uploads/whatsapp/audios/${audioFilename}`);

      // Check duration (approximate: audio file size / bitrate)
      const stats = fs.statSync(audioPath);
      const approxDurationSec = stats.size / 4000; // rough estimate for ogg/opus
      if (approxDurationSec > 300) { // 5 min
        await msg.reply('Áudio muito longo (máx 5 minutos). Pode resumir em uma mensagem mais curta?');
        return null;
      }

      // Transcribe
      const result = await elevenlabs.transcribe(audioPath);
      console.log(`[WhatsApp Audio] Transcription: "${(result.text || '').substring(0, 100)}"`);

      // Audit log
      try {
        const contact = await msg.getContact().catch(() => null);
        db.prepare(`INSERT INTO audit_log (user_id, acao, detalhes, ip, created_at)
          VALUES (NULL, 'whatsapp_audio', ?, NULL, datetime('now','localtime'))`)
          .run(JSON.stringify({
            direction: 'received',
            transcription: (result.text || '').substring(0, 200),
            duration_seconds: result.duration || Math.round(approxDurationSec),
            funcionario_nome: contact?.pushname || contact?.name || 'desconhecido'
          }));
      } catch (e) { /* ignore */ }

      return { text: result.text || '', duration: result.duration, audioPath: `/uploads/whatsapp/audios/${audioFilename}` };
    } catch (err) {
      console.error('[WhatsApp Audio STT] Error:', err.message);
      if (err.message.includes('Rate limit')) {
        await msg.reply('Limite de transcrições por hora atingido. Por favor, envie como texto.');
      } else {
        await msg.reply('Não consegui entender o áudio. Pode enviar por texto?');
      }
      return null;
    }
  }

  /**
   * Create a suggestion from an unmatched WhatsApp message
   */
  async createSuggestion(text, senderName, senderPhone, fonteTipo, imagemPath, audioPath, transcricao, msgDbId) {
    if (!process.env.ANTHROPIC_API_KEY) return null;

    try {
      const client = this._getAnthropicClient();
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: `A household employee sent this via WhatsApp. It doesn't match time clock, delivery, or document patterns. Analyze and suggest what action might be needed. Respond in JSON only (no markdown):
{"title": "short title in Portuguese", "description": "what needs to be done in Portuguese", "priority": "alta|media|baixa", "category": "manutencao|compras|limpeza|seguranca|financeiro|outro"}

Message from ${senderName}: "${text}"` }]
      });

      const responseText = (response.content[0]?.text || '').trim();
      let parsed;
      try {
        let jsonStr = responseText;
        const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        parsed = { title: text.substring(0, 80), description: text, priority: 'media', category: 'outro' };
      }

      const result = db.prepare(`
        INSERT INTO sugestoes_melhoria (titulo, descricao, prioridade, categoria, fonte, fonte_tipo, imagem_path, audio_path, transcricao, whatsapp_mensagem_id, remetente_nome, remetente_telefone)
        VALUES (?, ?, ?, ?, 'whatsapp', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        parsed.title || text.substring(0, 80),
        parsed.description || text,
        ['alta', 'media', 'baixa'].includes(parsed.priority) ? parsed.priority : 'media',
        parsed.category || 'outro',
        fonteTipo,
        imagemPath || null,
        audioPath || null,
        transcricao || null,
        msgDbId || null,
        senderName || null,
        senderPhone || null
      );

      const sugestaoId = result.lastInsertRowid;
      console.log(`[WhatsApp] Suggestion #${sugestaoId} created: "${parsed.title}"`);

      return {
        id: sugestaoId,
        titulo: parsed.title,
        descricao: parsed.description,
        prioridade: parsed.priority,
        categoria: parsed.category
      };
    } catch (err) {
      console.error('[WhatsApp Suggestion] Error:', err.message);
      return null;
    }
  }
}

module.exports = new WhatsAppService();
