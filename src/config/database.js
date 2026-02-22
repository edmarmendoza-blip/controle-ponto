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
      cargo TEXT NOT NULL,
      salario_hora REAL NOT NULL,
      telefone TEXT,
      foto TEXT,
      status TEXT DEFAULT 'ativo' CHECK(status IN ('ativo', 'inativo')),
      horario_entrada TEXT DEFAULT '08:00',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      ano INTEGER NOT NULL
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
    CREATE INDEX IF NOT EXISTS idx_whatsapp_mensagens_date ON whatsapp_mensagens(created_at);
    CREATE INDEX IF NOT EXISTS idx_whatsapp_mensagens_funcionario ON whatsapp_mensagens(funcionario_id);
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
}

module.exports = { db, initializeDatabase };
