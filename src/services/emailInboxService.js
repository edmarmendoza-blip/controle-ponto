const Imap = require('imap');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');
const { db } = require('../config/database');
const EmailInbox = require('../models/EmailInbox');

class EmailInboxService {
  constructor() {
    this._checking = false;
    this._interval = null;
  }

  /**
   * Start periodic email checking (every 5 minutes)
   */
  startChecking() {
    if (!process.env.IMAP_HOST || !process.env.IMAP_USER || !process.env.IMAP_PASSWORD) {
      console.log('[EmailInbox] IMAP not configured, skipping email inbox');
      return;
    }

    console.log('[EmailInbox] Starting email check interval (5 min)');
    // Check after 15s on start
    setTimeout(() => this.checkEmails().catch(e => console.error('[EmailInbox] Initial check error:', e.message)), 15000);
    // Then every 5 minutes
    this._interval = setInterval(() => {
      this.checkEmails().catch(e => console.error('[EmailInbox] Check error:', e.message));
    }, 5 * 60 * 1000);
  }

  /**
   * Connect to IMAP and fetch UNSEEN emails
   */
  async checkEmails() {
    if (this._checking) {
      console.log('[EmailInbox] Already checking, skipping');
      return;
    }
    this._checking = true;

    try {
      const messages = await this._fetchUnseen();
      console.log(`[EmailInbox] Found ${messages.length} new emails`);

      for (const msg of messages) {
        try {
          await this._processEmail(msg);
        } catch (e) {
          console.error(`[EmailInbox] Error processing email:`, e.message);
        }
      }
    } catch (err) {
      console.error('[EmailInbox] IMAP error:', err.message);
    } finally {
      this._checking = false;
    }
  }

  /**
   * Fetch UNSEEN emails via IMAP
   */
  _fetchUnseen() {
    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user: process.env.IMAP_USER,
        password: process.env.IMAP_PASSWORD,
        host: process.env.IMAP_HOST || 'imap.gmail.com',
        port: parseInt(process.env.IMAP_PORT) || 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 15000,
        authTimeout: 15000
      });

      const messages = [];
      let timeout = null;

      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        try { imap.end(); } catch (e) { /* ignore */ }
      };

      // Safety timeout
      timeout = setTimeout(() => {
        console.error('[EmailInbox] IMAP timeout after 60s');
        cleanup();
        resolve(messages);
      }, 60000);

      imap.once('error', (err) => {
        console.error('[EmailInbox] IMAP connection error:', err.message);
        cleanup();
        resolve(messages);
      });

      imap.once('ready', () => {
        imap.openBox('INBOX', false, (err) => {
          if (err) { cleanup(); return resolve(messages); }

          imap.search(['UNSEEN'], (err, results) => {
            if (err || !results || results.length === 0) {
              cleanup();
              return resolve(messages);
            }

            // Limit to 10 per batch
            const toFetch = results.slice(-10);
            const f = imap.fetch(toFetch, { bodies: '', markSeen: true });

            f.on('message', (msg) => {
              let buffer = '';
              msg.on('body', (stream) => {
                stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
              });
              msg.once('end', () => {
                messages.push({ raw: buffer });
              });
            });

            f.once('error', (err) => {
              console.error('[EmailInbox] Fetch error:', err.message);
            });

            f.once('end', () => {
              cleanup();
              resolve(messages);
            });
          });
        });
      });

      imap.connect();
    });
  }

  /**
   * Process a single email: parse, classify, save, notify
   */
  async _processEmail(rawMsg) {
    const parsed = await simpleParser(rawMsg.raw);

    const messageId = parsed.messageId || `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fromEmail = parsed.from?.value?.[0]?.address || '';
    const fromName = parsed.from?.value?.[0]?.name || fromEmail;
    const subject = (parsed.subject || '(sem assunto)').substring(0, 500);
    const bodyText = (parsed.text || '').substring(0, 5000);

    // Check for duplicate
    const existing = EmailInbox.findByMessageId(messageId);
    if (existing) {
      console.log(`[EmailInbox] Duplicate email, skipping: ${subject}`);
      return;
    }

    // Save attachments
    let attachmentPaths = [];
    const safeId = messageId.replace(/[^a-zA-Z0-9.-]/g, '_').substring(0, 50);
    const attachDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'emails', safeId);

    if (parsed.attachments && parsed.attachments.length > 0) {
      fs.mkdirSync(attachDir, { recursive: true });
      for (const att of parsed.attachments.slice(0, 10)) {
        try {
          const safeName = (att.filename || `attachment_${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_');
          const filePath = path.join(attachDir, safeName);
          fs.writeFileSync(filePath, att.content);
          attachmentPaths.push(`/uploads/emails/${safeId}/${safeName}`);
        } catch (e) {
          console.error('[EmailInbox] Attachment save error:', e.message);
        }
      }
    }

    // Build content for classification
    let classificationInput = `De: ${fromName} <${fromEmail}>\nAssunto: ${subject}\n\n${bodyText.substring(0, 3000)}`;

    // Extract text from PDF attachments
    if (parsed.attachments) {
      for (const att of parsed.attachments) {
        if (att.contentType === 'application/pdf' && att.content) {
          try {
            const pdfParse = require('pdf-parse');
            const pdfData = await pdfParse(att.content);
            if (pdfData.text) {
              classificationInput += `\n\n[PDF: ${att.filename}]\n${pdfData.text.substring(0, 2000)}`;
            }
          } catch (e) { /* PDF parse error, skip */ }
        }
      }
    }

    // Classify with Claude
    let classificacao = 'outro';
    let dadosExtraidos = null;
    let acaoSugerida = 'ignorar';
    let summary = '';

    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const Anthropic = require('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const resp = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          messages: [{ role: 'user', content: `Analise este email e classifique. Retorne APENAS JSON válido:
{
  "type": "convite|nota_fiscal|boleto|contrato|orcamento|comunicado|propaganda|outro",
  "extracted_data": {"date": null, "time": null, "location": null, "value": null, "person": null, "description": "..."},
  "suggested_action": "criar_evento|criar_tarefa|cadastrar_prestador|registrar_despesa|salvar_documento|ignorar",
  "confidence": 0-100,
  "summary": "descrição breve em português"
}

Email:
${classificationInput.substring(0, 3000)}` }]
        });

        const respText = (resp.content[0]?.text || '').trim();
        const cleaned = respText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
        let result;
        try { result = JSON.parse(cleaned); } catch (e) {
          const m = cleaned.match(/\{[\s\S]*\}/);
          if (m) result = JSON.parse(m[0]);
        }

        if (result) {
          classificacao = result.type || 'outro';
          dadosExtraidos = JSON.stringify(result.extracted_data || {});
          acaoSugerida = result.suggested_action || 'ignorar';
          summary = result.summary || '';
        }
      } catch (e) {
        console.error('[EmailInbox] Classification error:', e.message);
      }
    }

    // Save to database
    const emailId = EmailInbox.create({
      message_id: messageId,
      from_email: fromEmail,
      from_name: fromName,
      subject,
      body_text: bodyText.substring(0, 5000),
      attachments_count: attachmentPaths.length,
      attachment_paths: attachmentPaths.length > 0 ? JSON.stringify(attachmentPaths) : null,
      classificacao,
      dados_extraidos: dadosExtraidos,
      acao_sugerida: acaoSugerida,
      status: 'pendente'
    });

    console.log(`[EmailInbox] Email #${emailId} saved: ${classificacao} from ${fromName} — ${subject}`);

    // Send WhatsApp notification to admin (skip propaganda)
    if (classificacao !== 'propaganda') {
      await this._notifyAdmin(emailId, fromName, subject, classificacao, summary, acaoSugerida);
    }
  }

  /**
   * Notify admin via WhatsApp about new email
   */
  async _notifyAdmin(emailId, fromName, subject, tipo, summary, suggestedAction) {
    try {
      const whatsappService = require('./whatsapp');
      if (!whatsappService.ready) return;

      const admin = db.prepare("SELECT telefone FROM users WHERE role = 'admin' AND telefone IS NOT NULL ORDER BY id LIMIT 1").get();
      if (!admin || !admin.telefone) return;

      const actionLabels = {
        criar_evento: 'Criar evento',
        criar_tarefa: 'Criar tarefa',
        cadastrar_prestador: 'Cadastrar prestador',
        registrar_despesa: 'Registrar despesa',
        salvar_documento: 'Salvar documento',
        ignorar: 'Ignorar'
      };

      const typeLabels = {
        convite: 'Convite', nota_fiscal: 'Nota Fiscal', boleto: 'Boleto',
        contrato: 'Contrato', orcamento: 'Orçamento', comunicado: 'Comunicado',
        propaganda: 'Propaganda', outro: 'Outro'
      };

      let msg = `📩 *Novo email recebido*\n`;
      msg += `📤 De: ${fromName}\n`;
      msg += `📋 Assunto: ${subject.substring(0, 100)}\n`;
      msg += `📄 Tipo: ${typeLabels[tipo] || tipo}`;
      if (summary) msg += ` — ${summary}`;
      msg += `\n💡 Sugestão: ${actionLabels[suggestedAction] || suggestedAction}`;
      msg += `\n\nO que fazer?\n1️⃣ Executar sugestão\n2️⃣ Criar tarefa\n3️⃣ Salvar como documento\n4️⃣ Ignorar`;

      await whatsappService.sendPrivateMessage(admin.telefone, msg);

      // Create pending confirmation for response
      db.prepare(`INSERT INTO pending_confirmations (tipo, funcionario_id, data, horario, message_text, status, whatsapp_chat_id, created_at) VALUES ('email_action', 0, ?, '00:00', ?, 'pending', ?, datetime('now','localtime'))`).run(
        new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }),
        JSON.stringify({ email_id: emailId, suggested_action: suggestedAction, from: fromName, subject }),
        admin.telefone.replace(/\D/g, '').replace(/^55/, '') + '@c.us'
      );

      EmailInbox.update(emailId, { whatsapp_notified: 1 });
      console.log(`[EmailInbox] WhatsApp notification sent for email #${emailId}`);
    } catch (e) {
      console.error('[EmailInbox] Notification error:', e.message);
    }
  }
}

module.exports = new EmailInboxService();
