const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'database.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'viewer' CHECK(role IN ('admin', 'viewer')),
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
      tabela TEXT NOT NULL,
      registro_id INTEGER NOT NULL,
      acao TEXT NOT NULL,
      dados_anteriores TEXT,
      dados_novos TEXT,
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS configuracoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chave TEXT UNIQUE NOT NULL,
      valor TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_registros_data ON registros(data);
    CREATE INDEX IF NOT EXISTS idx_registros_funcionario ON registros(funcionario_id);
    CREATE INDEX IF NOT EXISTS idx_feriados_data ON feriados(data);
    CREATE INDEX IF NOT EXISTS idx_audit_log_tabela ON audit_log(tabela, registro_id);
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
