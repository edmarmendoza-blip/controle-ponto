const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'database.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initializeDatabase() {
  // Run migrations FIRST on existing databases before creating tables/indexes
  try {
    // Migrate audit_log table if old schema (has 'tabela' column instead of 'entity_type')
    const auditInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_log'").get();
    if (auditInfo && auditInfo.sql.includes('tabela')) {
      db.exec('DROP TABLE audit_log');
    }

    // Add 'gestor' role support - recreate users table constraint
    const userInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
    if (userInfo && !userInfo.sql.includes('gestor')) {
      db.exec(`
        ALTER TABLE users RENAME TO users_old;
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          name TEXT NOT NULL,
          role TEXT DEFAULT 'viewer' CHECK(role IN ('admin', 'gestor', 'viewer')),
          active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO users SELECT * FROM users_old;
        DROP TABLE users_old;
      `);
    }

    // Add geolocation columns to registros
    const regCols = db.prepare("PRAGMA table_info(registros)").all().map(c => c.name);
    if (regCols.length > 0 && !regCols.includes('latitude')) {
      db.exec('ALTER TABLE registros ADD COLUMN latitude REAL DEFAULT NULL');
      db.exec('ALTER TABLE registros ADD COLUMN longitude REAL DEFAULT NULL');
    }

    // Add horario_entrada to funcionarios
    const funcCols = db.prepare("PRAGMA table_info(funcionarios)").all().map(c => c.name);
    if (funcCols.length > 0 && !funcCols.includes('horario_entrada')) {
      db.exec("ALTER TABLE funcionarios ADD COLUMN horario_entrada TEXT DEFAULT '08:00'");
    }

    // Add media columns to whatsapp_mensagens
    const wmCols = db.prepare("PRAGMA table_info(whatsapp_mensagens)").all().map(c => c.name);
    if (wmCols.length > 0 && !wmCols.includes('media_type')) {
      db.exec('ALTER TABLE whatsapp_mensagens ADD COLUMN media_type TEXT DEFAULT NULL');
      db.exec('ALTER TABLE whatsapp_mensagens ADD COLUMN media_path TEXT DEFAULT NULL');
    }

    // Add payroll columns to funcionarios
    const funcColsPayroll = db.prepare("PRAGMA table_info(funcionarios)").all().map(c => c.name);
    if (funcColsPayroll.length > 0 && !funcColsPayroll.includes('valor_hora_extra')) {
      db.exec('ALTER TABLE funcionarios ADD COLUMN valor_hora_extra REAL DEFAULT 43.25');
      db.exec('ALTER TABLE funcionarios ADD COLUMN valor_dia_especial REAL DEFAULT 320.00');
      db.exec('ALTER TABLE funcionarios ADD COLUMN jornada_diaria REAL DEFAULT 9.8');
    }

    // Add recorrente column to feriados
    const ferCols = db.prepare("PRAGMA table_info(feriados)").all().map(c => c.name);
    if (ferCols.length > 0 && !ferCols.includes('recorrente')) {
      db.exec('ALTER TABLE feriados ADD COLUMN recorrente INTEGER DEFAULT 1');
    }

    // Migrate status 'inativo' -> 'desligado' and update CHECK constraint
    try {
      db.exec("UPDATE funcionarios SET status = 'desligado' WHERE status = 'inativo'");
    } catch (e) { /* ignore */ }

    // Part 2: Add complete employee registration fields
    const funcColsFull = db.prepare("PRAGMA table_info(funcionarios)").all().map(c => c.name);
    if (funcColsFull.length > 0 && !funcColsFull.includes('classificacao')) {
      const newCols = [
        // Classificação e Status
        "classificacao TEXT DEFAULT 'operacional'",
        "email_pessoal TEXT",
        "data_admissao DATE",
        "data_desligamento DATE",
        "motivo_desligamento TEXT",
        // Benefícios
        "contabiliza_hora_extra INTEGER DEFAULT 1",
        "recebe_vt INTEGER DEFAULT 1",
        "recebe_va INTEGER DEFAULT 1",
        "contabiliza_feriado INTEGER DEFAULT 1",
        // Jornada via IA
        "jornada_texto TEXT",
        "jornada_json TEXT",
        // Vale-Transporte
        "tipo_transporte TEXT DEFAULT 'diario'",
        "valor_fixo_transporte REAL DEFAULT 0",
        // Vale-Alimentação
        "tem_vale_alimentacao INTEGER DEFAULT 0",
        "valor_va_dia REAL DEFAULT 0",
        // PIX
        "pix_tipo TEXT",
        "pix_chave TEXT",
        "pix_banco TEXT",
        // Férias
        "ferias_inicio DATE",
        "ferias_fim DATE",
        "ferias_status TEXT DEFAULT 'sem_direito'",
        // Comunicação
        "notificacoes_ativas INTEGER DEFAULT 0",
        "notificacoes_config TEXT"
      ];
      for (const col of newCols) {
        try { db.exec(`ALTER TABLE funcionarios ADD COLUMN ${col}`); } catch (e) { /* column may already exist */ }
      }
    }
  } catch (migrationErr) {
    console.error('Migration warning:', migrationErr.message);
  }

  // Now create tables and indexes (safe for both fresh and migrated databases)
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'viewer' CHECK(role IN ('admin', 'gestor', 'viewer')),
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS funcionarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      cargo TEXT,
      salario_hora REAL DEFAULT 0,
      telefone TEXT,
      foto TEXT,
      status TEXT DEFAULT 'ativo' CHECK(status IN ('ativo', 'desligado')),
      horario_entrada TEXT DEFAULT '08:00',
      valor_hora_extra REAL DEFAULT 43.25,
      valor_dia_especial REAL DEFAULT 320.00,
      jornada_diaria REAL DEFAULT 9.8,
      classificacao TEXT DEFAULT 'operacional',
      email_pessoal TEXT,
      data_admissao DATE,
      data_desligamento DATE,
      motivo_desligamento TEXT,
      contabiliza_hora_extra INTEGER DEFAULT 1,
      recebe_vt INTEGER DEFAULT 1,
      recebe_va INTEGER DEFAULT 1,
      contabiliza_feriado INTEGER DEFAULT 1,
      jornada_texto TEXT,
      jornada_json TEXT,
      tipo_transporte TEXT DEFAULT 'diario',
      valor_fixo_transporte REAL DEFAULT 0,
      tem_vale_alimentacao INTEGER DEFAULT 0,
      valor_va_dia REAL DEFAULT 0,
      pix_tipo TEXT,
      pix_chave TEXT,
      pix_banco TEXT,
      ferias_inicio DATE,
      ferias_fim DATE,
      ferias_status TEXT DEFAULT 'sem_direito',
      notificacoes_ativas INTEGER DEFAULT 0,
      notificacoes_config TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS funcionario_transportes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      funcionario_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      nome_linha TEXT,
      valor_trecho REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS registros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      funcionario_id INTEGER NOT NULL,
      data DATE NOT NULL,
      entrada TIME,
      saida TIME,
      tipo TEXT DEFAULT 'manual' CHECK(tipo IN ('manual', 'whatsapp')),
      observacao TEXT,
      created_by INTEGER,
      updated_by INTEGER,
      latitude REAL DEFAULT NULL,
      longitude REAL DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (updated_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS feriados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data DATE NOT NULL,
      descricao TEXT NOT NULL,
      tipo TEXT DEFAULT 'nacional' CHECK(tipo IN ('nacional', 'estadual', 'municipal', 'facultativo')),
      ano INTEGER NOT NULL,
      recorrente INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS configuracoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chave TEXT UNIQUE NOT NULL,
      valor TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS whatsapp_mensagens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT UNIQUE,
      sender_phone TEXT,
      sender_name TEXT,
      funcionario_id INTEGER,
      message_text TEXT,
      message_type TEXT DEFAULT 'other' CHECK(message_type IN ('entrada', 'saida', 'other')),
      processed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
    );

    CREATE INDEX IF NOT EXISTS idx_registros_data ON registros(data);
    CREATE INDEX IF NOT EXISTS idx_registros_funcionario ON registros(funcionario_id);
    CREATE INDEX IF NOT EXISTS idx_feriados_data ON feriados(data);
    CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
    CREATE TABLE IF NOT EXISTS insights_ia (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data DATE NOT NULL UNIQUE,
      insights_json TEXT NOT NULL,
      mensagens_analisadas INTEGER DEFAULT 0,
      modelo TEXT DEFAULT 'claude-sonnet-4-6',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_whatsapp_mensagens_date ON whatsapp_mensagens(created_at);
    CREATE INDEX IF NOT EXISTS idx_whatsapp_mensagens_funcionario ON whatsapp_mensagens(funcionario_id);
    CREATE INDEX IF NOT EXISTS idx_insights_ia_data ON insights_ia(data);
  `);

  // Default configs
  const configs = [
    ['multiplicador_hora_extra', '1.5'],
    ['multiplicador_feriado', '2.0'],
    ['multiplicador_domingo', '2.0'],
    ['horas_dia_normal', '8'],
    ['horas_semana_normal', '44'],
    ['whatsapp_enabled', 'false']
  ];

  const insertConfig = db.prepare('INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES (?, ?)');
  for (const [chave, valor] of configs) {
    insertConfig.run(chave, valor);
  }

  // Seed São Paulo 2026 holidays
  seedFeriados2026();
}

function seedFeriados2026() {
  const feriados = [
    { data: '2026-01-01', descricao: 'Confraternização Universal', tipo: 'nacional', ano: 2026, recorrente: 1 },
    { data: '2026-01-25', descricao: 'Aniversário de São Paulo', tipo: 'municipal', ano: 2026, recorrente: 1 },
    { data: '2026-02-17', descricao: 'Carnaval', tipo: 'nacional', ano: 2026, recorrente: 0 },
    { data: '2026-04-03', descricao: 'Sexta-feira Santa', tipo: 'nacional', ano: 2026, recorrente: 0 },
    { data: '2026-04-21', descricao: 'Tiradentes', tipo: 'nacional', ano: 2026, recorrente: 1 },
    { data: '2026-05-01', descricao: 'Dia do Trabalho', tipo: 'nacional', ano: 2026, recorrente: 1 },
    { data: '2026-06-19', descricao: 'Corpus Christi', tipo: 'nacional', ano: 2026, recorrente: 0 },
    { data: '2026-07-09', descricao: 'Revolução Constitucionalista', tipo: 'estadual', ano: 2026, recorrente: 1 },
    { data: '2026-09-07', descricao: 'Independência do Brasil', tipo: 'nacional', ano: 2026, recorrente: 1 },
    { data: '2026-10-12', descricao: 'Nossa Sra. Aparecida', tipo: 'nacional', ano: 2026, recorrente: 1 },
    { data: '2026-11-02', descricao: 'Finados', tipo: 'nacional', ano: 2026, recorrente: 1 },
    { data: '2026-11-15', descricao: 'Proclamação da República', tipo: 'nacional', ano: 2026, recorrente: 1 },
    { data: '2026-11-20', descricao: 'Consciência Negra', tipo: 'municipal', ano: 2026, recorrente: 1 },
    { data: '2026-12-25', descricao: 'Natal', tipo: 'nacional', ano: 2026, recorrente: 1 }
  ];

  const insertFeriado = db.prepare(
    'INSERT OR IGNORE INTO feriados (data, descricao, tipo, ano, recorrente) VALUES (?, ?, ?, ?, ?)'
  );
  for (const f of feriados) {
    // Only insert if not already exists for this date
    const existing = db.prepare('SELECT id FROM feriados WHERE data = ?').get(f.data);
    if (!existing) {
      insertFeriado.run(f.data, f.descricao, f.tipo, f.ano, f.recorrente);
    }
  }
}

module.exports = { db, initializeDatabase };
