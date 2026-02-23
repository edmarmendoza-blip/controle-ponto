const Imap = require('imap');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');
const { db } = require('../config/database');

class HoleriteIMAP {
  static getConfig() {
    const user = process.env.HOLERITE_IMAP_USER;
    const pass = process.env.HOLERITE_IMAP_PASS || process.env.SMTP_PASS;
    if (!user || !pass) return null;

    return {
      user,
      password: pass,
      host: process.env.HOLERITE_IMAP_HOST || 'imap.gmail.com',
      port: parseInt(process.env.HOLERITE_IMAP_PORT || '993'),
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    };
  }

  static async sync() {
    const config = this.getConfig();
    if (!config) {
      console.warn('[Holerite IMAP] IMAP não configurado (falta HOLERITE_IMAP_USER ou senha)');
      return { success: false, error: 'IMAP não configurado' };
    }

    // Ensure upload directory exists
    const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'holerites');
    fs.mkdirSync(uploadDir, { recursive: true });

    // Ensure table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS holerites_email (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email_uid TEXT UNIQUE,
        email_from TEXT,
        email_subject TEXT,
        email_date DATETIME,
        attachment_name TEXT,
        file_path TEXT,
        funcionario_id INTEGER,
        processado INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
      )
    `);

    return new Promise((resolve) => {
      const imap = new Imap(config);
      const results = { found: 0, saved: 0, skipped: 0, errors: [] };

      imap.once('ready', () => {
        imap.openBox('INBOX', true, (err) => {
          if (err) {
            imap.end();
            return resolve({ success: false, error: 'Erro ao abrir INBOX: ' + err.message });
          }

          // Search for emails with holerite/contracheque in subject
          const searchCriteria = [
            ['OR',
              ['SUBJECT', 'holerite'],
              ['SUBJECT', 'contracheque']
            ],
            ['SINCE', this._getSearchSince()]
          ];

          imap.search(searchCriteria, (err, uids) => {
            if (err) {
              imap.end();
              return resolve({ success: false, error: 'Erro na busca: ' + err.message });
            }

            if (!uids || uids.length === 0) {
              imap.end();
              return resolve({ success: true, ...results, message: 'Nenhum email encontrado' });
            }

            results.found = uids.length;
            let processed = 0;

            const fetch = imap.fetch(uids, { bodies: '', struct: true });

            fetch.on('message', (msg, seqno) => {
              let uid = null;

              msg.on('attributes', (attrs) => {
                uid = String(attrs.uid);
              });

              msg.on('body', (stream) => {
                simpleParser(stream, async (err, parsed) => {
                  processed++;

                  if (err) {
                    results.errors.push(`Email ${seqno}: ${err.message}`);
                    if (processed >= uids.length) { imap.end(); resolve({ success: true, ...results }); }
                    return;
                  }

                  // Check if already processed
                  const existing = db.prepare('SELECT id FROM holerites_email WHERE email_uid = ?').get(uid);
                  if (existing) {
                    results.skipped++;
                    if (processed >= uids.length) { imap.end(); resolve({ success: true, ...results }); }
                    return;
                  }

                  // Process attachments (PDFs and images)
                  const attachments = (parsed.attachments || []).filter(a =>
                    a.contentType === 'application/pdf' ||
                    a.contentType.startsWith('image/')
                  );

                  for (const att of attachments) {
                    try {
                      const date = parsed.date ? parsed.date.toISOString().split('T')[0] : 'unknown';
                      const safeName = att.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
                      const filename = `${date}_${uid}_${safeName}`;
                      const filePath = path.join(uploadDir, filename);
                      fs.writeFileSync(filePath, att.content);

                      const relPath = `/uploads/holerites/${filename}`;

                      db.prepare(`
                        INSERT OR IGNORE INTO holerites_email
                        (email_uid, email_from, email_subject, email_date, attachment_name, file_path)
                        VALUES (?, ?, ?, ?, ?, ?)
                      `).run(
                        uid,
                        parsed.from?.text || '',
                        parsed.subject || '',
                        parsed.date?.toISOString() || '',
                        att.filename,
                        relPath
                      );

                      results.saved++;
                      console.log(`[Holerite IMAP] Saved: ${att.filename}`);
                    } catch (saveErr) {
                      results.errors.push(`Attachment ${att.filename}: ${saveErr.message}`);
                    }
                  }

                  if (attachments.length === 0) {
                    results.skipped++;
                  }

                  if (processed >= uids.length) {
                    imap.end();
                    resolve({ success: true, ...results });
                  }
                });
              });
            });

            fetch.once('error', (err) => {
              imap.end();
              resolve({ success: false, error: 'Fetch error: ' + err.message });
            });

            fetch.once('end', () => {
              if (processed >= uids.length) {
                imap.end();
              }
            });
          });
        });
      });

      imap.once('error', (err) => {
        resolve({ success: false, error: 'IMAP error: ' + err.message });
      });

      imap.once('end', () => {
        console.log('[Holerite IMAP] Connection closed');
      });

      imap.connect();
    });
  }

  static _getSearchSince() {
    // Search last 90 days
    const since = new Date();
    since.setDate(since.getDate() - 90);
    return since;
  }

  static getAll() {
    return db.prepare(`
      SELECT he.*, f.nome as funcionario_nome
      FROM holerites_email he
      LEFT JOIN funcionarios f ON he.funcionario_id = f.id
      ORDER BY he.email_date DESC
    `).all();
  }

  static linkToEmployee(holeriteId, funcionarioId) {
    db.prepare('UPDATE holerites_email SET funcionario_id = ?, processado = 1 WHERE id = ?')
      .run(funcionarioId, holeriteId);
  }
}

module.exports = HoleriteIMAP;
