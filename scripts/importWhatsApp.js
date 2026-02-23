#!/usr/bin/env node

/**
 * Importa histórico de chat WhatsApp exportado (.txt) para o banco de dados.
 * Uso: node scripts/importWhatsApp.js /caminho/do/arquivo.txt
 */

const fs = require('fs');
const path = require('path');

// Ajustar path para carregar módulos do projeto
const { db } = require('../src/config/database');
const Funcionario = require('../src/models/Funcionario');

// --- Patterns copiados de src/services/whatsapp.js ---
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

// --- Helpers ---

function normalizeName(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function parseIntent(text) {
  for (const pattern of ENTRADA_PATTERNS) {
    if (pattern.test(text)) return 'entrada';
  }
  for (const pattern of SAIDA_PATTERNS) {
    if (pattern.test(text)) return 'saida';
  }
  return 'other';
}

// Mapa de aliases: nome WhatsApp -> nome cadastrado no banco
const NAME_ALIASES = {
  'amores da minha vida': 'roberto',
  'n655194': 'noemia',
  'verinha': 'verinha',
  'neusa folguista baba': 'neusa',
  'adriana': 'adriana',
  'nete empregada': 'noemia', // Nete/Ivonete was before Noemia
  'edmar mendoza bot': '__skip__', // Bot messages - don't match
  'carolina junqueira bull': '__skip__', // Patroa - not employee
};

function matchEmployee(senderName, funcionarios) {
  const normalized = normalizeName(senderName);

  // Skip known non-employees
  for (const [alias, target] of Object.entries(NAME_ALIASES)) {
    if (normalized.includes(normalizeName(alias))) {
      if (target === '__skip__') return null;
      // Find employee by alias target
      for (const f of funcionarios) {
        if (normalizeName(f.nome).includes(target)) return f;
      }
    }
  }

  // Exact match
  for (const f of funcionarios) {
    if (normalizeName(f.nome) === normalized) return f;
  }

  // Partial match: first name or sender contains employee name
  for (const f of funcionarios) {
    const nomeNorm = normalizeName(f.nome);
    const firstName = nomeNorm.split(' ')[0];
    const senderFirst = normalized.split(' ')[0];
    if (firstName === senderFirst) return f;
    if (nomeNorm.includes(normalized) || normalized.includes(nomeNorm)) return f;
  }

  return null;
}

// --- Parser ---

/**
 * WhatsApp export format (iOS BR):
 * [D/M/YY, HH:MM:SS] Name: Message
 * Lines may start with invisible chars (LTR mark \u200e)
 */
const MSG_LINE_RE = /^\u200e?\[(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s*(\d{2}:\d{2}:\d{2})\]\s*(.+?):\s(.+)$/;

/**
 * System messages (no ":" after name/content):
 * [D/M/YY, HH:MM:SS] System message here
 */
const SYSTEM_LINE_RE = /^\u200e?\[(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s*(\d{2}:\d{2}:\d{2})\]\s*(.+)$/;

/**
 * System message content patterns to skip
 */
const SYSTEM_PATTERNS = [
  /adicionou/i,
  /removeu/i,
  /saiu$/i,
  /mensagens temporárias/i,
  /criptografia/i,
  /código de segurança/i,
  /Ligação de/i,
  /Você adicionou/i,
];

function isSystemMessage(sender, text) {
  // Group name as sender (e.g. "Casa dos Bull")
  if (sender === 'Casa dos Bull') return true;
  // Known system patterns in text
  for (const p of SYSTEM_PATTERNS) {
    if (p.test(text)) return true;
  }
  return false;
}

/**
 * Normalize date from D/M/YY or D/M/YYYY to DD/MM/YYYY
 */
function normalizeDate(dateStr) {
  const [d, m, y] = dateStr.split('/');
  const day = d.padStart(2, '0');
  const month = m.padStart(2, '0');
  const year = y.length === 2 ? `20${y}` : y;
  return { day, month, year, display: `${day}/${month}/${year}` };
}

/**
 * Clean sender name: remove ~ prefix, invisible chars, trim
 */
function cleanSenderName(name) {
  return name
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '') // remove bidi/LTR marks
    .replace(/^~\s*/, '') // remove ~ prefix
    .trim();
}

function parseExportFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const messages = [];
  let current = null;

  for (const rawLine of lines) {
    // Strip invisible characters at start of line
    const line = rawLine.replace(/^\u200e+/, '');

    const msgMatch = line.match(MSG_LINE_RE);
    if (msgMatch) {
      // Save previous message
      if (current) messages.push(current);

      const [, dateStr, time, rawSender, text] = msgMatch;
      const sender = cleanSenderName(rawSender);
      const cleanText = text.replace(/^\u200e+/, '').trim();

      // Check if it's a system message disguised as user message
      if (isSystemMessage(sender, cleanText)) {
        current = null;
        continue;
      }

      // Skip "Mensagem apagada" (deleted messages)
      if (/^Mensagem apagada$/i.test(cleanText) || /^\u200eMensagem apagada$/i.test(text)) {
        current = null;
        continue;
      }

      const { day, month, year, display } = normalizeDate(dateStr);
      current = { date: display, day, month, year, time: time.slice(0, 5), sender, text: cleanText };
      continue;
    }

    // Check if it's a system line (no colon after name)
    const sysMatch = line.match(SYSTEM_LINE_RE);
    if (sysMatch) {
      // Save previous and skip system message
      if (current) messages.push(current);
      current = null;
      continue;
    }

    // Continuation of previous message (multiline)
    if (current && line.trim()) {
      current.text += '\n' + line;
    }
  }

  // Don't forget last message
  if (current) messages.push(current);

  return messages;
}

// --- Main ---

function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Uso: node scripts/importWhatsApp.js <arquivo.txt>');
    console.error('Exemplo: node scripts/importWhatsApp.js /tmp/chat-casadosbull.txt');
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Arquivo não encontrado: ${resolvedPath}`);
    process.exit(1);
  }

  console.log(`\n📂 Lendo arquivo: ${resolvedPath}`);

  // Parse all messages
  const allMessages = parseExportFile(resolvedPath);
  console.log(`📝 Total de mensagens parseadas: ${allMessages.length}`);

  // Filter only February 2026
  const feb2026 = allMessages.filter(m => m.month === '02' && m.year === '2026');
  console.log(`📅 Mensagens de fevereiro/2026: ${feb2026.length}`);

  if (feb2026.length === 0) {
    console.log('\n⚠️  Nenhuma mensagem de fevereiro/2026 encontrada. Verifique o formato do arquivo.');
    process.exit(0);
  }

  // Load employees for matching
  const funcionarios = Funcionario.getAll(true); // include inactive
  console.log(`👥 Funcionários no banco: ${funcionarios.length}`);
  if (funcionarios.length > 0) {
    console.log(`   Nomes: ${funcionarios.map(f => f.nome).join(', ')}`);
  }

  // Prepare insert statement
  const insert = db.prepare(`
    INSERT OR IGNORE INTO whatsapp_mensagens
      (message_id, sender_phone, sender_name, funcionario_id, message_text, message_type, processed, created_at, media_type, media_path)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Stats
  let imported = 0;
  let skipped = 0;
  const byDay = {};
  const bySender = {};
  let entradas = 0;
  let saidas = 0;

  const insertAll = db.transaction(() => {
    feb2026.forEach((msg, index) => {
      // Build timestamp: YYYY-MM-DD HH:MM:00
      const isoDate = `${msg.year}-${msg.month}-${msg.day} ${msg.time}:00`;

      // Generate unique message_id
      const messageId = `import_${msg.year}${msg.month}${msg.day}_${msg.time.replace(':', '')}_${index}`;

      // Detect media: <anexado: ...>, <Mídia oculta>, <Media omitted>
      const isMedia = /^<anexado:\s*.+>$|^<Mídia oculta>$|^<Media omitted>$/i.test(msg.text.trim())
        || /\u200e?<anexado:\s*.+>$/i.test(msg.text.trim());
      const mediaType = isMedia ? 'image' : null;
      const messageText = isMedia ? '<Mídia oculta>' : msg.text;

      // Detect intent
      const messageType = isMedia ? 'other' : parseIntent(msg.text);

      // Match employee
      const employee = matchEmployee(msg.sender, funcionarios);
      const funcionarioId = employee ? employee.id : null;

      // Insert
      const result = insert.run(
        messageId,
        null, // sender_phone not available in export
        msg.sender,
        funcionarioId,
        messageText,
        messageType,
        messageType !== 'other' ? 1 : 0, // processed if intent detected
        isoDate,
        mediaType,
        null // media_path
      );

      if (result.changes > 0) {
        imported++;

        // Stats
        byDay[msg.date] = (byDay[msg.date] || 0) + 1;
        bySender[msg.sender] = (bySender[msg.sender] || 0) + 1;
        if (messageType === 'entrada') entradas++;
        if (messageType === 'saida') saidas++;
      } else {
        skipped++;
      }
    });
  });

  insertAll();

  // --- Resumo ---
  console.log('\n' + '='.repeat(50));
  console.log('📊 RESUMO DA IMPORTAÇÃO');
  console.log('='.repeat(50));
  console.log(`✅ Importadas: ${imported}`);
  console.log(`⏭️  Ignoradas (duplicatas): ${skipped}`);
  console.log(`🟢 Entradas detectadas: ${entradas}`);
  console.log(`🔴 Saídas detectadas: ${saidas}`);

  if (Object.keys(byDay).length > 0) {
    console.log('\n📅 Por dia:');
    const sortedDays = Object.entries(byDay).sort((a, b) => {
      const [dA, mA, yA] = a[0].split('/');
      const [dB, mB, yB] = b[0].split('/');
      return `${yA}${mA.padStart(2,'0')}${dA.padStart(2,'0')}`.localeCompare(`${yB}${mB.padStart(2,'0')}${dB.padStart(2,'0')}`);
    });
    for (const [day, count] of sortedDays) {
      console.log(`   ${day}: ${count} mensagens`);
    }
  }

  if (Object.keys(bySender).length > 0) {
    console.log('\n👤 Por remetente:');
    const sortedSenders = Object.entries(bySender).sort((a, b) => b[1] - a[1]);
    for (const [sender, count] of sortedSenders) {
      const emp = matchEmployee(sender, funcionarios);
      const match = emp ? ` → ${emp.nome} (ID ${emp.id})` : ' → [não vinculado]';
      console.log(`   ${sender}: ${count} mensagens${match}`);
    }
  }

  console.log('\n✨ Importação concluída!');
}

main();
