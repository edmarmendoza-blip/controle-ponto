/**
 * Import historical WhatsApp clock data into sandbox database.
 *
 * RULES:
 * - NEVER overwrite existing records
 * - INSERT OR IGNORE based on funcionario_id + data + tipo combination
 * - Employee overrides Cargo (employee value is truth)
 * - Skip Carolina and Edmar (owners)
 *
 * Source: production database (readonly)
 * Target: sandbox database
 */

const Database = require('better-sqlite3');
const prodDb = new Database('/home/claude/controle-ponto/database.sqlite', { readonly: true });
const sandboxDb = new Database('/home/claude/controle-ponto-sandbox/database-sandbox.sqlite');

// Name mapping: WhatsApp name → sandbox funcionario name
const NAME_MAP = {
  'Adriano Motorista': 'Adriano Motorista',
  'Adriano': 'Adriano Motorista',
  'Amores Da Minha Vida 🥰♥️': 'Roberto (Sr. Roberto)',
  '~ Amores Da Minha Vida 🥰♥️': 'Roberto (Sr. Roberto)',
  'n655194': 'Noemia',
  '~ n655194': 'Noemia',
  'Neusa Folguista Baba': 'Neusa',
  'Neusa Cruz': 'Neusa',
  'Cyntia (Assistente Pessoal)': 'Cyntia Lepique',
  'Cynthia Lepique': 'Cyntia Lepique',
  'Adriana ✨🦋✨': 'Adriana',
  '~ Adriana ✨🦋✨': 'Adriana',
  'VERINHA': 'Verinha',
  '~ VERINHA': 'Verinha',
  'Maria Gorete Baba': '__CREATE_Maria Gorete',
  'Analina Barbosa': '__CREATE_Analina Barbosa',
  '~ Analina Barbosa': '__CREATE_Analina Barbosa',
  'Nete 💥🙏🌷empregada': '__CREATE_Ivonete',
  'Mara Baba Folguista': '__CREATE_Mara',
};

// Skip these senders (owners/bot)
const SKIP_SENDERS = [
  'Carolina Junqueira Bull',
  'Edmar Mendoza Bull',
  'Edmar Mendoza Bot',
];

// Clock keywords classification
function classifyMessage(text) {
  if (!text) return null;
  const lower = text.toLowerCase().replace(/\n/g, ' ');

  // Skip media-only, very short non-clock, or instruction messages
  if (lower.includes('<mídia oculta>')) return null;
  if (lower.includes('atenção')) return null;
  if (lower.includes('por favor')) return null;
  if (lower.includes('precisa avisar')) return null;
  if (lower.includes('não esquece')) return null;
  if (lower.includes('favor escrever')) return null;
  if (lower.includes('bot de controle')) return null;
  if (lower.includes('ao entrar marcar')) return null;
  if (lower.includes('entrada registrada')) return null;
  if (lower.includes('saida registrada') || lower.includes('saída registrada')) return null;

  // SAÍDA patterns (check first - more specific)
  if (lower.includes('finalizando') || lower.includes('finalizado')) return 'saida';
  if (lower.includes('boa noite') && (lower.includes('saindo') || lower.includes('saíndo') || lower.includes('indo'))) return 'saida';
  if (lower.includes('boa noite') && lower.length < 40) return 'saida';
  if (lower.includes('saindo pro almoço') || lower.includes('saindo pra almo') || lower.includes('sai do pro almo')) return 'almoco_saida';
  if (lower.includes('saindo') && lower.length < 30) return 'saida';
  if (lower.includes('indo embora') || lower.includes('fui embora') || lower.includes('estou indo embora')) return 'saida';
  if (lower.match(/^fui\b/)) return 'saida';
  if (lower.includes('terminei') || lower.includes('encerr')) return 'saida';
  if (lower.includes('almoçando') || lower.includes('indo almoçar') || lower.includes('indo almocar')) return 'almoco_saida';

  // ENTRADA patterns
  if (lower.includes('bom dia') && lower.length < 60) return 'entrada';
  if (lower.includes('cheguei') || lower.includes('chegamos') || lower.includes('chegando')) return 'entrada';
  if (lower.includes('já estou na casa') || lower.includes('estou na casa')) return 'entrada';
  if (lower.includes('voltei') || lower.includes('retornei')) return 'almoco_retorno';
  if (lower.includes('na casa') && lower.length < 30) return 'entrada';

  return null;
}

// Extract time from created_at (format: "2026-02-02 08:21:00")
function extractTime(createdAt) {
  const parts = createdAt.split(' ');
  if (parts.length >= 2) {
    return parts[1].substring(0, 5); // "08:21"
  }
  return null;
}

// Extract date from created_at
function extractDate(createdAt) {
  return createdAt.split(' ')[0]; // "2026-02-02"
}

// ========== STEP 1: Create inactive employees that don't exist ==========
console.log('=== STEP 1: Creating inactive employees ===');

const inactiveEmployees = [
  { nome: 'Maria Gorete', cargo: 'Babá', data_desligamento: '2025-10-28', key: '__CREATE_Maria Gorete' },
  { nome: 'Analina Barbosa', cargo: 'Empregada Doméstica', data_desligamento: '2025-10-17', key: '__CREATE_Analina Barbosa' },
  { nome: 'Ivonete', cargo: 'Empregada Doméstica', data_desligamento: '2025-12-10', key: '__CREATE_Ivonete' },
  { nome: 'Mara', cargo: 'Babá Folguista', data_desligamento: '2026-01-25', key: '__CREATE_Mara' },
];

const createdIds = {};
for (const emp of inactiveEmployees) {
  const existing = sandboxDb.prepare('SELECT id FROM funcionarios WHERE nome = ?').get(emp.nome);
  if (existing) {
    console.log(`  Already exists: ${emp.nome} (id=${existing.id})`);
    createdIds[emp.key] = existing.id;
  } else {
    // Find cargo_id
    const cargo = sandboxDb.prepare('SELECT id FROM cargos WHERE nome = ?').get(emp.cargo);
    const cargoId = cargo ? cargo.id : null;
    const result = sandboxDb.prepare(
      "INSERT INTO funcionarios (nome, cargo, cargo_id, status, data_desligamento, created_at) VALUES (?, ?, ?, 'inativo', ?, datetime('now','localtime'))"
    ).run(emp.nome, emp.cargo, cargoId, emp.data_desligamento);
    console.log(`  Created: ${emp.nome} (id=${result.lastInsertRowid}, cargo=${emp.cargo}, desligamento=${emp.data_desligamento})`);
    createdIds[emp.key] = result.lastInsertRowid;
  }
}

// ========== STEP 2: Build funcionario lookup ==========
console.log('\n=== STEP 2: Building employee lookup ===');
const allFuncs = sandboxDb.prepare('SELECT id, nome FROM funcionarios').all();
const funcLookup = {};
for (const f of allFuncs) {
  funcLookup[f.nome] = f.id;
}
// Add created IDs
for (const [key, id] of Object.entries(createdIds)) {
  funcLookup[key] = id;
}

// ========== STEP 3: Process WhatsApp messages ==========
console.log('\n=== STEP 3: Processing WhatsApp messages ===');

const allMessages = prodDb.prepare(
  'SELECT sender_name, message_text, message_type, created_at FROM whatsapp_mensagens ORDER BY created_at'
).all();

console.log(`  Total messages in production: ${allMessages.length}`);

// Collect clock events per employee per day
// Structure: { "funcId:date" → { entrada: "HH:MM", saida: "HH:MM" } }
const clockEvents = {};

let skipped = 0, processed = 0, unmapped = 0;

for (const msg of allMessages) {
  const sender = msg.sender_name;

  // Skip owners/bot
  if (SKIP_SENDERS.includes(sender)) { skipped++; continue; }

  // Map sender name to system name
  const systemName = NAME_MAP[sender];
  if (!systemName) {
    // Try partial match
    const found = Object.keys(NAME_MAP).find(k => sender.includes(k) || k.includes(sender));
    if (!found) { unmapped++; continue; }
  }

  const mappedName = NAME_MAP[sender] || NAME_MAP[Object.keys(NAME_MAP).find(k => sender.includes(k) || k.includes(sender))];
  if (!mappedName) { unmapped++; continue; }

  // Get funcionario ID
  const funcId = funcLookup[mappedName];
  if (!funcId) {
    console.log(`  WARNING: No employee found for "${mappedName}" (sender: ${sender})`);
    continue;
  }

  // Classify the message
  let tipo = null;
  if (msg.message_type === 'entrada') {
    tipo = 'entrada';
  } else if (msg.message_type === 'saida') {
    tipo = classifyMessage(msg.message_text) || 'saida';
  } else {
    tipo = classifyMessage(msg.message_text);
  }

  if (!tipo) continue;

  const date = extractDate(msg.created_at);
  const time = extractTime(msg.created_at);
  const key = `${funcId}:${date}`;

  if (!clockEvents[key]) {
    clockEvents[key] = { funcId, date, entrada: null, saida: null, almoco_saida: null, almoco_retorno: null, funcName: mappedName };
  }

  const ev = clockEvents[key];

  if (tipo === 'entrada') {
    // First entrada of the day wins
    if (!ev.entrada) ev.entrada = time;
  } else if (tipo === 'saida') {
    // Last saida of the day wins
    ev.saida = time;
  } else if (tipo === 'almoco_saida') {
    if (!ev.almoco_saida) ev.almoco_saida = time;
    // If this is also the only "saida" for the day, don't overwrite a real saida
  } else if (tipo === 'almoco_retorno') {
    ev.almoco_retorno = time;
  }

  processed++;
}

console.log(`  Processed: ${processed}, Skipped (owners/bot): ${skipped}, Unmapped: ${unmapped}`);
console.log(`  Unique employee-day combinations: ${Object.keys(clockEvents).length}`);

// ========== STEP 4: Insert records into sandbox ==========
console.log('\n=== STEP 4: Inserting records ===');

// Check existing registros
const existingRegistros = new Set();
sandboxDb.prepare('SELECT funcionario_id, data FROM registros').all().forEach(r => {
  existingRegistros.add(`${r.funcionario_id}:${r.data}`);
});
console.log(`  Existing registros in sandbox: ${existingRegistros.size}`);

const insertStmt = sandboxDb.prepare(
  "INSERT INTO registros (funcionario_id, data, entrada, saida, tipo, observacao, created_at, updated_at) VALUES (?, ?, ?, ?, 'whatsapp', ?, datetime('now','localtime'), datetime('now','localtime'))"
);

let inserted = 0, alreadyExists = 0, noData = 0;

const insertMany = sandboxDb.transaction(() => {
  for (const ev of Object.values(clockEvents)) {
    const key = `${ev.funcId}:${ev.date}`;

    // Skip if already exists
    if (existingRegistros.has(key)) {
      alreadyExists++;
      continue;
    }

    // Must have at least entrada or saida
    const entrada = ev.entrada;
    // For saida: use explicit saida, or if only almoco_saida exists, use it
    const saida = ev.saida || null;

    if (!entrada && !saida) {
      noData++;
      continue;
    }

    const obs = 'Importado do histórico WhatsApp';

    insertStmt.run(ev.funcId, ev.date, entrada, saida, obs);
    inserted++;
    console.log(`  + ${ev.funcName} | ${ev.date} | ${entrada || '-'} → ${saida || '-'}`);
  }
});

insertMany();

console.log(`\n=== RESULTADO ===`);
console.log(`  ✅ Inseridos: ${inserted}`);
console.log(`  ⏭️  Já existiam: ${alreadyExists}`);
console.log(`  ⚠️  Sem dados: ${noData}`);

// ========== STEP 5: Summary ==========
console.log('\n=== REGISTROS POR FUNCIONÁRIO (após importação) ===');
sandboxDb.prepare(`
  SELECT f.nome, COUNT(r.id) as total, MIN(r.data) as primeira, MAX(r.data) as ultima
  FROM registros r JOIN funcionarios f ON r.funcionario_id = f.id
  GROUP BY r.funcionario_id ORDER BY f.nome
`).all().forEach(r => {
  console.log(`  ${r.nome}: ${r.total} registros (${r.primeira} → ${r.ultima})`);
});

prodDb.close();
sandboxDb.close();
console.log('\nDone!');
