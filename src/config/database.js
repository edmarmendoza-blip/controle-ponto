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
      db.exec('ALTER TABLE audit_log RENAME TO audit_log_old');
      console.log('[Migration] Renamed audit_log → audit_log_old for schema migration');
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
          created_at DATETIME DEFAULT (datetime('now','localtime')),
          updated_at DATETIME DEFAULT (datetime('now','localtime'))
        );
        INSERT INTO users SELECT * FROM users_old;
        DROP TABLE users_old;
      `);
    }

    // Cache PRAGMA table_info results to avoid repeated calls (was 17 calls, now 1 per table)
    const _funcCols = db.prepare("PRAGMA table_info(funcionarios)").all().map(c => c.name);
    const _regCols = db.prepare("PRAGMA table_info(registros)").all().map(c => c.name);
    const _wmCols = db.prepare("PRAGMA table_info(whatsapp_mensagens)").all().map(c => c.name);
    const _ferCols = db.prepare("PRAGMA table_info(feriados)").all().map(c => c.name);
    const _userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);

    // Add geolocation columns to registros
    if (_regCols.length > 0 && !_regCols.includes('latitude')) {
      db.exec('ALTER TABLE registros ADD COLUMN latitude REAL DEFAULT NULL');
      db.exec('ALTER TABLE registros ADD COLUMN longitude REAL DEFAULT NULL');
    }

    // Add horario_entrada to funcionarios
    if (_funcCols.length > 0 && !_funcCols.includes('horario_entrada')) {
      db.exec("ALTER TABLE funcionarios ADD COLUMN horario_entrada TEXT DEFAULT '08:00'");
    }

    // Add media columns to whatsapp_mensagens
    if (_wmCols.length > 0 && !_wmCols.includes('media_type')) {
      db.exec('ALTER TABLE whatsapp_mensagens ADD COLUMN media_type TEXT DEFAULT NULL');
      db.exec('ALTER TABLE whatsapp_mensagens ADD COLUMN media_path TEXT DEFAULT NULL');
    }

    // Add payroll columns to funcionarios
    if (_funcCols.length > 0 && !_funcCols.includes('valor_hora_extra')) {
      db.exec('ALTER TABLE funcionarios ADD COLUMN valor_hora_extra REAL DEFAULT 43.25');
      db.exec('ALTER TABLE funcionarios ADD COLUMN valor_dia_especial REAL DEFAULT 320.00');
      db.exec('ALTER TABLE funcionarios ADD COLUMN jornada_diaria REAL DEFAULT 9.8');
    }

    // Add recorrente column to feriados
    if (_ferCols.length > 0 && !_ferCols.includes('recorrente')) {
      db.exec('ALTER TABLE feriados ADD COLUMN recorrente INTEGER DEFAULT 1');
    }

    // Add manual column to feriados (manual edits prevail over sync)
    if (_ferCols.length > 0 && !_ferCols.includes('manual')) {
      db.exec('ALTER TABLE feriados ADD COLUMN manual INTEGER DEFAULT 0');
    }

    // Migrate status 'inativo' -> 'desligado' and update CHECK constraint
    try {
      db.exec("UPDATE funcionarios SET status = 'desligado' WHERE status = 'inativo'");
    } catch (e) { /* ignore */ }

    // Part 2: Add complete employee registration fields
    if (_funcCols.length > 0 && !_funcCols.includes('classificacao')) {
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
    // Add personal/document/address fields to funcionarios
    if (_funcCols.length > 0 && !_funcCols.includes('cpf')) {
      const personalCols = [
        "cpf TEXT",
        "rg TEXT",
        "data_nascimento DATE",
        "data_inicio_trabalho DATE",
        "data_inicio_registro_carteira DATE",
        "endereco_cep TEXT",
        "endereco_rua TEXT",
        "endereco_numero TEXT",
        "endereco_complemento TEXT",
        "endereco_bairro TEXT",
        "endereco_cidade TEXT",
        "endereco_estado TEXT",
        "telefone_contato2 TEXT",
        "telefone_emergencia TEXT",
        "nome_contato_emergencia TEXT",
        "recebe_ajuda_combustivel INTEGER DEFAULT 0",
        "valor_ajuda_combustivel REAL DEFAULT 0"
      ];
      for (const col of personalCols) {
        try { db.exec(`ALTER TABLE funcionarios ADD COLUMN ${col}`); } catch (e) { /* column may already exist */ }
      }
    }
    // Add combustivel columns if missing
    if (!_funcCols.includes('recebe_ajuda_combustivel')) {
      try { db.exec("ALTER TABLE funcionarios ADD COLUMN recebe_ajuda_combustivel INTEGER DEFAULT 0"); } catch(e) {}
      try { db.exec("ALTER TABLE funcionarios ADD COLUMN valor_ajuda_combustivel REAL DEFAULT 0"); } catch(e) {}
    }

    // Add 2FA columns to users
    if (_userCols.length > 0 && !_userCols.includes('totp_secret')) {
      try { db.exec('ALTER TABLE users ADD COLUMN totp_secret TEXT DEFAULT NULL'); } catch (e) { /* ignore */ }
      try { db.exec('ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0'); } catch (e) { /* ignore */ }
    }

    // Add password reset columns to users
    if (_userCols.length > 0 && !_userCols.includes('reset_code')) {
      try { db.exec('ALTER TABLE users ADD COLUMN reset_code TEXT DEFAULT NULL'); } catch (e) { /* ignore */ }
      try { db.exec('ALTER TABLE users ADD COLUMN reset_code_expires DATETIME DEFAULT NULL'); } catch (e) { /* ignore */ }
    }

    // Add task permission columns to users
    if (_userCols.length > 0 && !_userCols.includes('pode_criar_tarefas')) {
      try { db.exec('ALTER TABLE users ADD COLUMN pode_criar_tarefas INTEGER DEFAULT 0'); } catch (e) { /* ignore */ }
      try { db.exec('ALTER TABLE users ADD COLUMN pode_criar_tarefas_whatsapp INTEGER DEFAULT 0'); } catch (e) { /* ignore */ }
      try { db.exec('ALTER TABLE users ADD COLUMN telefone TEXT DEFAULT NULL'); } catch (e) { /* ignore */ }
    }

    // Add cargo_id to funcionarios
    if (_funcCols.length > 0 && !_funcCols.includes('cargo_id')) {
      try { db.exec('ALTER TABLE funcionarios ADD COLUMN cargo_id INTEGER REFERENCES cargos(id)'); } catch (e) { /* ignore */ }
    }

    // Remove restrictive CHECK on cargos.tipo_dias_dormida (recreate table without it)
    try {
      const cargoCheck = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='cargos'").get();
      if (cargoCheck && cargoCheck.sql && cargoCheck.sql.includes("CHECK(tipo_dias_dormida IN ('semana', 'mes', 'escala'))")) {
        const migrateCargos = db.transaction(() => {
          db.exec(`
            CREATE TABLE cargos_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              nome TEXT NOT NULL UNIQUE,
              precisa_bater_ponto INTEGER DEFAULT 1,
              permite_hora_extra INTEGER DEFAULT 1,
              permite_dia_extra INTEGER DEFAULT 0,
              valor_hora_extra REAL DEFAULT 0,
              valor_dia_extra REAL DEFAULT 0,
              recebe_vale_transporte INTEGER DEFAULT 1,
              valor_vale_transporte REAL DEFAULT 0,
              recebe_vale_refeicao INTEGER DEFAULT 0,
              valor_vale_refeicao REAL DEFAULT 0,
              recebe_ajuda_combustivel INTEGER DEFAULT 0,
              valor_ajuda_combustivel REAL DEFAULT 0,
              dorme_no_local INTEGER DEFAULT 0,
              dias_dormida INTEGER DEFAULT 0,
              tipo_dias_dormida TEXT DEFAULT 'uteis',
              ativo INTEGER DEFAULT 1,
              created_at DATETIME DEFAULT (datetime('now','localtime')),
              updated_at DATETIME DEFAULT (datetime('now','localtime'))
            );
            INSERT INTO cargos_new SELECT * FROM cargos;
            DROP TABLE cargos;
            ALTER TABLE cargos_new RENAME TO cargos;
          `);
        });
        migrateCargos();
        console.log('[Migration] Removed CHECK constraint on cargos.tipo_dias_dormida');
      }
    } catch (e) { console.error('[Migration] cargos CHECK removal:', e.message); }

    // Ensure essential cargos exist
    try {
      const essentialCargos = [
        { nome: 'Babá', precisa_bater_ponto: 1, permite_hora_extra: 1, permite_dia_extra: 0, valor_hora_extra: 30, valor_dia_extra: 0, recebe_vale_transporte: 1, recebe_vale_refeicao: 0, recebe_ajuda_combustivel: 0 },
        { nome: 'Babá Folguista', precisa_bater_ponto: 1, permite_hora_extra: 1, permite_dia_extra: 0, valor_hora_extra: 30, valor_dia_extra: 0, recebe_vale_transporte: 1, recebe_vale_refeicao: 0, recebe_ajuda_combustivel: 0 },
        { nome: 'Governanta', precisa_bater_ponto: 0, permite_hora_extra: 0, permite_dia_extra: 0, valor_hora_extra: 0, valor_dia_extra: 0, recebe_vale_transporte: 1, recebe_vale_refeicao: 1, recebe_ajuda_combustivel: 0 },
        { nome: 'Caseiro', precisa_bater_ponto: 1, permite_hora_extra: 1, permite_dia_extra: 1, valor_hora_extra: 35, valor_dia_extra: 250, recebe_vale_transporte: 0, recebe_vale_refeicao: 0, recebe_ajuda_combustivel: 0 }
      ];
      for (const c of essentialCargos) {
        const exists = db.prepare('SELECT id FROM cargos WHERE nome = ?').get(c.nome);
        if (!exists) {
          db.prepare('INSERT INTO cargos (nome, precisa_bater_ponto, permite_hora_extra, permite_dia_extra, valor_hora_extra, valor_dia_extra, recebe_vale_transporte, recebe_vale_refeicao, recebe_ajuda_combustivel) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            c.nome, c.precisa_bater_ponto, c.permite_hora_extra, c.permite_dia_extra, c.valor_hora_extra, c.valor_dia_extra, c.recebe_vale_transporte, c.recebe_vale_refeicao, c.recebe_ajuda_combustivel
          );
          console.log(`[Migration] Created cargo: ${c.nome}`);
        }
      }
    } catch (e) { console.error('[Migration] essential cargos:', e.message); }

    // Migrate cargo text to cargo_id where null (includes 'A definir')
    try {
      const funcs = db.prepare("SELECT id, nome, cargo FROM funcionarios WHERE cargo_id IS NULL").all();
      const cargos = db.prepare('SELECT id, nome FROM cargos').all();
      let updated = 0;
      for (const f of funcs) {
        const cargoText = (f.cargo || '').toLowerCase();
        // Direct name matching
        let match = cargos.find(c => cargoText.includes(c.nome.toLowerCase()));
        // For 'A definir' or empty: check if name suggests Dono(a) da Casa
        if (!match && (cargoText === 'a definir' || cargoText === '')) {
          const nomeLC = f.nome.toLowerCase();
          if (nomeLC.includes('edmar') || nomeLC.includes('carolina')) {
            match = cargos.find(c => c.nome.toLowerCase().includes('dono'));
          }
        }
        // Specific nickname matches
        if (!match) {
          if (cargoText.includes('caseiro') || cargoText.includes('cuidador')) {
            match = cargos.find(c => c.nome.toLowerCase() === 'caseiro');
          }
        }
        if (match) {
          db.prepare('UPDATE funcionarios SET cargo_id = ?, cargo = ? WHERE id = ?').run(match.id, match.nome, f.id);
          updated++;
        }
      }
      if (updated > 0) console.log(`[Migration] Linked ${updated} funcionarios to cargo_id`);
    } catch (e) { console.error('[Migration] cargo_id link:', e.message); }

    // Reset hardcoded default values to 0 so employees inherit from cargo
    try {
      // Only reset if ALL values are the old hardcoded defaults (43.25, 320, 9.8)
      const resetCount = db.prepare(`
        UPDATE funcionarios SET
          valor_hora_extra = 0,
          valor_dia_especial = 0,
          salario_hora = 0,
          contabiliza_hora_extra = 0,
          recebe_vt = 0,
          recebe_va = 0
        WHERE cargo_id IS NOT NULL
          AND (valor_hora_extra = 43.25 OR valor_hora_extra = 0)
          AND (valor_dia_especial = 320 OR valor_dia_especial = 0)
          AND contabiliza_hora_extra = 1
          AND recebe_vt = 1
          AND recebe_va = 1
      `).run();
      if (resetCount.changes > 0) console.log(`[Migration] Reset ${resetCount.changes} funcionarios old defaults to inherit from cargo`);
    } catch (e) { console.error('[Migration] reset defaults:', e.message); }
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
      totp_secret TEXT DEFAULT NULL,
      totp_enabled INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS funcionarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      cargo TEXT,
      salario_hora REAL DEFAULT 0,
      telefone TEXT,
      foto TEXT,
      status TEXT DEFAULT 'ativo' CHECK(status IN ('ativo', 'inativo')),
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
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
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
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime')),
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
      recorrente INTEGER DEFAULT 1,
      manual INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      user_nome TEXT,
      user_email TEXT,
      acao TEXT DEFAULT 'login',
      ip TEXT,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
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
      media_type TEXT DEFAULT NULL,
      media_path TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
    );

    CREATE TABLE IF NOT EXISTS cargos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      precisa_bater_ponto INTEGER DEFAULT 1,
      permite_hora_extra INTEGER DEFAULT 1,
      permite_dia_extra INTEGER DEFAULT 0,
      valor_hora_extra REAL DEFAULT 0,
      valor_dia_extra REAL DEFAULT 0,
      recebe_vale_transporte INTEGER DEFAULT 1,
      valor_vale_transporte REAL DEFAULT 0,
      recebe_vale_refeicao INTEGER DEFAULT 0,
      valor_vale_refeicao REAL DEFAULT 0,
      recebe_ajuda_combustivel INTEGER DEFAULT 0,
      valor_ajuda_combustivel REAL DEFAULT 0,
      dorme_no_local INTEGER DEFAULT 0,
      dias_dormida INTEGER DEFAULT 0,
      tipo_dias_dormida TEXT DEFAULT 'uteis',
      ativo INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_registros_data ON registros(data);
    CREATE INDEX IF NOT EXISTS idx_registros_funcionario ON registros(funcionario_id);
    CREATE INDEX IF NOT EXISTS idx_feriados_data ON feriados(data);
    CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
  `);

  // Migrate data from old audit_log if it was renamed
  try {
    const oldAuditExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log_old'").get();
    if (oldAuditExists) {
      // Get old columns to build a safe migration query
      const oldCols = db.prepare("PRAGMA table_info(audit_log_old)").all().map(c => c.name);
      const hasAction = oldCols.includes('action');
      const hasAcao = oldCols.includes('acao');
      const actionCol = hasAction ? 'action' : hasAcao ? 'acao' : "'unknown'";
      const entityCol = oldCols.includes('entity_type') ? 'entity_type' : oldCols.includes('tabela') ? 'tabela' : "'unknown'";
      db.exec(`INSERT OR IGNORE INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
        SELECT user_id, COALESCE(${actionCol}, 'unknown'), COALESCE(${entityCol}, 'unknown'), entity_id, details, ip_address, created_at FROM audit_log_old`);
      db.exec('DROP TABLE audit_log_old');
      console.log('[Migration] Migrated audit_log_old data → audit_log');
    }
  } catch (e) { console.error('[Migration] audit_log data migration:', e.message); }

  db.exec(`
    CREATE TABLE IF NOT EXISTS insights_ia (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data DATE NOT NULL UNIQUE,
      insights_json TEXT NOT NULL,
      mensagens_analisadas INTEGER DEFAULT 0,
      modelo TEXT DEFAULT 'claude-sonnet-4-6',
      created_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS pending_confirmations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      funcionario_id INTEGER NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('entrada', 'saida', 'saida_almoco', 'retorno_almoco', 'entrega')),
      data DATE NOT NULL,
      horario TEXT NOT NULL,
      message_text TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'denied', 'expired')),
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      resolved_at DATETIME,
      FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
    );

    CREATE INDEX IF NOT EXISTS idx_pending_confirmations_status ON pending_confirmations(funcionario_id, status);
    CREATE TABLE IF NOT EXISTS entregas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      funcionario_id INTEGER,
      data_hora DATETIME DEFAULT (datetime('now','localtime')),
      imagem_path TEXT,
      destinatario TEXT,
      remetente TEXT,
      transportadora TEXT,
      descricao TEXT,
      whatsapp_mensagem_id INTEGER,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id),
      FOREIGN KEY (whatsapp_mensagem_id) REFERENCES whatsapp_mensagens(id)
    );

    CREATE INDEX IF NOT EXISTS idx_whatsapp_mensagens_date ON whatsapp_mensagens(created_at);
    CREATE INDEX IF NOT EXISTS idx_whatsapp_mensagens_funcionario ON whatsapp_mensagens(funcionario_id);
    CREATE INDEX IF NOT EXISTS idx_insights_ia_data ON insights_ia(data);
    CREATE INDEX IF NOT EXISTS idx_entregas_data ON entregas(data_hora);
    CREATE INDEX IF NOT EXISTS idx_entregas_funcionario ON entregas(funcionario_id);

    CREATE TABLE IF NOT EXISTS tarefas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL,
      descricao TEXT,
      prioridade TEXT DEFAULT 'media',
      prazo TEXT,
      criado_por INTEGER REFERENCES users(id),
      status TEXT DEFAULT 'pendente',
      fonte TEXT DEFAULT 'web',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS tarefa_funcionarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tarefa_id INTEGER REFERENCES tarefas(id) ON DELETE CASCADE,
      funcionario_id INTEGER REFERENCES funcionarios(id),
      status TEXT DEFAULT 'pendente',
      concluida_em TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tarefas_status ON tarefas(status);
    CREATE INDEX IF NOT EXISTS idx_tarefas_prazo ON tarefas(prazo);
    CREATE INDEX IF NOT EXISTS idx_tarefa_funcionarios_tarefa ON tarefa_funcionarios(tarefa_id);

    CREATE TABLE IF NOT EXISTS whatsapp_chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      funcionario_id INTEGER REFERENCES funcionarios(id),
      direcao TEXT,
      tipo TEXT DEFAULT 'texto',
      conteudo TEXT,
      media_path TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_whatsapp_chats_func ON whatsapp_chats(funcionario_id);

    CREATE TABLE IF NOT EXISTS veiculos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marca TEXT,
      modelo TEXT,
      ano_fabricacao INTEGER,
      ano_modelo INTEGER,
      cor TEXT,
      placa TEXT UNIQUE,
      renavam TEXT,
      chassi TEXT,
      combustivel TEXT DEFAULT 'flex',
      km_atual INTEGER DEFAULT 0,
      seguradora TEXT,
      seguro_apolice TEXT,
      seguro_vigencia_inicio TEXT,
      seguro_vigencia_fim TEXT,
      seguro_valor REAL,
      ipva_valor REAL,
      ipva_vencimento TEXT,
      ipva_status TEXT DEFAULT 'pendente',
      licenciamento_ano INTEGER,
      licenciamento_status TEXT DEFAULT 'pendente',
      ultima_revisao_data TEXT,
      ultima_revisao_km INTEGER,
      proxima_revisao_data TEXT,
      proxima_revisao_km INTEGER,
      responsavel_id INTEGER REFERENCES funcionarios(id),
      crlv_foto_path TEXT,
      observacoes TEXT,
      status TEXT DEFAULT 'ativo',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS documentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL,
      descricao TEXT,
      entidade_tipo TEXT NOT NULL,
      entidade_id INTEGER NOT NULL,
      arquivo_path TEXT NOT NULL,
      arquivo_original TEXT,
      dados_extraidos TEXT,
      enviado_por_whatsapp INTEGER DEFAULT 0,
      whatsapp_mensagem_id TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);

  // Migrate pending_confirmations to include 'entrega' in tipo CHECK (post-CREATE)
  try {
    const pcInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='pending_confirmations'").get();
    if (pcInfo && pcInfo.sql && !pcInfo.sql.includes("'entrega'")) {
      // Drop leftover temp table if exists from failed previous migration
      try { db.exec('DROP TABLE IF EXISTS pending_confirmations_mig'); } catch(e) {}
      db.exec(`
        CREATE TABLE pending_confirmations_mig (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          funcionario_id INTEGER NOT NULL,
          tipo TEXT NOT NULL CHECK(tipo IN ('entrada', 'saida', 'saida_almoco', 'retorno_almoco', 'entrega')),
          data DATE NOT NULL,
          horario TEXT NOT NULL,
          message_text TEXT,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'denied', 'expired')),
          created_at DATETIME DEFAULT (datetime('now','localtime')),
          resolved_at DATETIME,
          FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
        );
        INSERT INTO pending_confirmations_mig SELECT * FROM pending_confirmations;
        DROP TABLE pending_confirmations;
        ALTER TABLE pending_confirmations_mig RENAME TO pending_confirmations;
        CREATE INDEX IF NOT EXISTS idx_pending_confirmations_status ON pending_confirmations(funcionario_id, status);
      `);
      console.log('[Migration] pending_confirmations: added entrega to tipo CHECK');
    }
  } catch (e) { console.error('[Migration] pending_confirmations tipo:', e.message); }

  // Add whatsapp_chat_id to pending_confirmations (idempotent)
  try {
    const pcCols = db.prepare("PRAGMA table_info(pending_confirmations)").all();
    if (!pcCols.find(c => c.name === 'whatsapp_chat_id')) {
      db.exec("ALTER TABLE pending_confirmations ADD COLUMN whatsapp_chat_id TEXT");
      console.log('[Migration] pending_confirmations: added whatsapp_chat_id');
    }
    // Add documento_upload to tipo CHECK if needed (rebuild table)
    const pcInfo2 = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='pending_confirmations'").get();
    if (pcInfo2 && pcInfo2.sql && !pcInfo2.sql.includes("'documento_upload'")) {
      try { db.exec('DROP TABLE IF EXISTS pending_confirmations_mig2'); } catch(e) {}
      db.exec(`
        CREATE TABLE pending_confirmations_mig2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          funcionario_id INTEGER,
          tipo TEXT NOT NULL CHECK(tipo IN ('entrada', 'saida', 'saida_almoco', 'retorno_almoco', 'entrega', 'documento_upload', 'despesa_aprovacao', 'nota_fiscal')),
          data TEXT,
          horario TEXT,
          message_text TEXT,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'denied', 'expired', 'rejected')),
          created_at DATETIME DEFAULT (datetime('now','localtime')),
          resolved_at DATETIME,
          whatsapp_chat_id TEXT,
          FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
        );
        INSERT INTO pending_confirmations_mig2 (id, funcionario_id, tipo, data, horario, message_text, status, created_at, resolved_at, whatsapp_chat_id) SELECT id, funcionario_id, tipo, data, horario, message_text, status, created_at, resolved_at, whatsapp_chat_id FROM pending_confirmations;
        DROP TABLE pending_confirmations;
        ALTER TABLE pending_confirmations_mig2 RENAME TO pending_confirmations;
        CREATE INDEX IF NOT EXISTS idx_pending_confirmations_status ON pending_confirmations(funcionario_id, status);
      `);
      console.log('[Migration] pending_confirmations: added documento_upload tipo + nullable fields');
    }
  } catch (e) { console.error('[Migration] pending_confirmations upgrade:', e.message); }

  // Add despesa_aprovacao and nota_fiscal to pending_confirmations tipo CHECK if needed
  try {
    const pcInfo3 = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='pending_confirmations'").get();
    if (pcInfo3 && pcInfo3.sql && !pcInfo3.sql.includes("'despesa_aprovacao'")) {
      try { db.exec('DROP TABLE IF EXISTS pending_confirmations_mig3'); } catch(e) {}
      db.exec(`
        CREATE TABLE pending_confirmations_mig3 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          funcionario_id INTEGER,
          tipo TEXT NOT NULL CHECK(tipo IN ('entrada', 'saida', 'saida_almoco', 'retorno_almoco', 'entrega', 'documento_upload', 'despesa_aprovacao', 'nota_fiscal')),
          data TEXT,
          horario TEXT,
          message_text TEXT,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'denied', 'expired', 'rejected')),
          created_at DATETIME DEFAULT (datetime('now','localtime')),
          resolved_at DATETIME,
          whatsapp_chat_id TEXT,
          FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
        );
        INSERT INTO pending_confirmations_mig3 (id, funcionario_id, tipo, data, horario, message_text, status, created_at, resolved_at, whatsapp_chat_id) SELECT id, funcionario_id, tipo, data, horario, message_text, status, created_at, resolved_at, whatsapp_chat_id FROM pending_confirmations;
        DROP TABLE pending_confirmations;
        ALTER TABLE pending_confirmations_mig3 RENAME TO pending_confirmations;
        CREATE INDEX IF NOT EXISTS idx_pending_confirmations_status ON pending_confirmations(funcionario_id, status);
      `);
      console.log('[Migration] pending_confirmations: added despesa_aprovacao, nota_fiscal to tipo CHECK');
    }
  } catch (e) { console.error('[Migration] pending_confirmations despesa/nota_fiscal:', e.message); }

  // Migration: cargos.aparece_relatorios
  try {
    const cols = db.prepare("PRAGMA table_info(cargos)").all();
    if (!cols.find(c => c.name === 'aparece_relatorios')) {
      db.exec("ALTER TABLE cargos ADD COLUMN aparece_relatorios INTEGER DEFAULT 1");
      // Dono(a) da Casa should not appear in reports
      db.prepare("UPDATE cargos SET aparece_relatorios = 0 WHERE nome LIKE '%Dono%' OR nome LIKE '%Dona%'").run();
      console.log('[Migration] cargos: added aparece_relatorios');
    }
  } catch (e) { console.error('[Migration] cargos aparece_relatorios:', e.message); }

  // Migration: funcionarios.bigdatacorp_data
  try {
    db.exec("ALTER TABLE funcionarios ADD COLUMN bigdatacorp_data TEXT");
    console.log('[Migration] funcionarios: added bigdatacorp_data');
  } catch (e) { /* column already exists */ }

  // Migration: estoque tables
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS estoque_itens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        categoria TEXT DEFAULT 'outros',
        unidade TEXT DEFAULT 'un',
        quantidade_atual REAL DEFAULT 0,
        quantidade_minima REAL DEFAULT 0,
        localizacao TEXT,
        ativo INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS estoque_movimentacoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER REFERENCES estoque_itens(id),
        tipo TEXT,
        quantidade REAL,
        observacao TEXT,
        registrado_por INTEGER,
        fonte TEXT DEFAULT 'manual',
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
    `);
  } catch (e) { console.error('[Migration] estoque tables:', e.message); }

  // Refresh tokens table
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
    `);
  } catch (e) { console.error('[Migration] refresh_tokens table:', e.message); }

  // Sugestoes de melhoria table
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sugestoes_melhoria (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        titulo TEXT NOT NULL,
        descricao TEXT,
        prioridade TEXT DEFAULT 'media' CHECK(prioridade IN ('alta','media','baixa')),
        categoria TEXT DEFAULT 'outro',
        fonte TEXT DEFAULT 'whatsapp',
        fonte_tipo TEXT DEFAULT 'texto',
        imagem_path TEXT,
        audio_path TEXT,
        transcricao TEXT,
        whatsapp_mensagem_id INTEGER,
        remetente_nome TEXT,
        remetente_telefone TEXT,
        status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente','em_analise','convertida','ignorada')),
        convertida_tarefa_id INTEGER REFERENCES tarefas(id),
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_sugestoes_status ON sugestoes_melhoria(status);
    `);
  } catch (e) { console.error('[Migration] sugestoes_melhoria table:', e.message); }

  // Lista de Compras + Historico de Precos tables
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS listas_compras (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        categoria TEXT DEFAULT 'mercado',
        status TEXT DEFAULT 'aberta',
        criado_por TEXT,
        observacoes TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS lista_compras_itens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lista_id INTEGER REFERENCES listas_compras(id) ON DELETE CASCADE,
        nome_item TEXT NOT NULL,
        quantidade REAL DEFAULT 1,
        unidade TEXT DEFAULT 'un',
        categoria_item TEXT DEFAULT 'outro',
        comprado INTEGER DEFAULT 0,
        preco_pago REAL,
        estabelecimento TEXT,
        data_compra TEXT,
        nota_fiscal_path TEXT,
        observacao TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS historico_precos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome_item TEXT NOT NULL,
        nome_normalizado TEXT NOT NULL,
        preco REAL NOT NULL,
        estabelecimento TEXT,
        categoria TEXT,
        fonte TEXT DEFAULT 'manual',
        nota_fiscal_path TEXT,
        data_compra TEXT DEFAULT (datetime('now','localtime')),
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_listas_compras_status ON listas_compras(status);
      CREATE INDEX IF NOT EXISTS idx_lista_itens_lista ON lista_compras_itens(lista_id);
      CREATE INDEX IF NOT EXISTS idx_historico_precos_nome ON historico_precos(nome_normalizado);
      CREATE INDEX IF NOT EXISTS idx_historico_precos_data ON historico_precos(data_compra);
    `);
  } catch (e) { console.error('[Migration] listas_compras tables:', e.message); }

  // Despesas table
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS despesas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        funcionario_id INTEGER REFERENCES funcionarios(id),
        descricao TEXT NOT NULL,
        valor REAL NOT NULL,
        categoria TEXT DEFAULT 'outro',
        estabelecimento TEXT,
        data_despesa TEXT,
        comprovante_path TEXT,
        dados_extraidos TEXT,
        fonte TEXT DEFAULT 'whatsapp',
        fonte_chat TEXT,
        status TEXT DEFAULT 'pendente',
        aprovado_por TEXT,
        data_aprovacao TEXT,
        data_reembolso TEXT,
        observacao TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_despesas_status ON despesas(status);
      CREATE INDEX IF NOT EXISTS idx_despesas_funcionario ON despesas(funcionario_id);
      CREATE INDEX IF NOT EXISTS idx_despesas_data ON despesas(data_despesa);
    `);
  } catch (e) { console.error('[Migration] despesas table:', e.message); }

  // Prestadores tables
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS prestadores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        telefone TEXT,
        email TEXT,
        empresa TEXT,
        cnpj TEXT,
        cpf TEXT,
        tipo TEXT DEFAULT 'avulso',
        frequencia_tipo TEXT,
        frequencia_vezes INTEGER,
        frequencia_dias TEXT,
        servico_descricao TEXT,
        valor_visita REAL,
        valor_mensal REAL,
        pix_chave TEXT,
        pix_tipo TEXT,
        banco TEXT,
        agencia TEXT,
        conta TEXT,
        observacoes TEXT,
        status TEXT DEFAULT 'ativo',
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS prestador_visitas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prestador_id INTEGER REFERENCES prestadores(id),
        data_entrada TEXT,
        data_saida TEXT,
        servico_realizado TEXT,
        valor_cobrado REAL,
        avaliacao INTEGER,
        observacao TEXT,
        fonte TEXT DEFAULT 'manual',
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS prestador_pagamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prestador_id INTEGER REFERENCES prestadores(id),
        visita_id INTEGER REFERENCES prestador_visitas(id),
        valor REAL,
        data_pagamento TEXT,
        metodo TEXT DEFAULT 'pix',
        comprovante_path TEXT,
        status TEXT DEFAULT 'pendente',
        observacao TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_prestador_visitas_pid ON prestador_visitas(prestador_id);
      CREATE INDEX IF NOT EXISTS idx_prestador_pagamentos_pid ON prestador_pagamentos(prestador_id);
    `);
  } catch (e) { console.error('[Migration] prestadores tables:', e.message); }

  // Email inbox table
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS email_inbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT UNIQUE,
        from_email TEXT,
        from_name TEXT,
        subject TEXT,
        body_text TEXT,
        attachments_count INTEGER DEFAULT 0,
        attachment_paths TEXT,
        classificacao TEXT,
        dados_extraidos TEXT,
        acao_sugerida TEXT,
        acao_executada TEXT,
        status TEXT DEFAULT 'pendente',
        whatsapp_notified INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_email_inbox_status ON email_inbox(status);
      CREATE INDEX IF NOT EXISTS idx_email_inbox_msgid ON email_inbox(message_id);
    `);
  } catch (e) { console.error('[Migration] email_inbox table:', e.message); }

  // Cleanup expired refresh tokens
  try {
    db.prepare("DELETE FROM refresh_tokens WHERE expires_at < datetime('now','localtime')").run();
  } catch (e) { /* table may not exist yet */ }

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

  // Seed default cargos
  seedCargos();
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

function seedCargos() {
  const cargos = [
    { nome: 'Motorista', precisa_bater_ponto: 1, permite_hora_extra: 1, permite_dia_extra: 1, valor_hora_extra: 43.25, valor_dia_extra: 320, recebe_vale_transporte: 0, valor_vale_transporte: 0, recebe_vale_refeicao: 1, valor_vale_refeicao: 35, recebe_ajuda_combustivel: 1, valor_ajuda_combustivel: 500, dorme_no_local: 0, dias_dormida: 0, tipo_dias_dormida: 'semana' },
    { nome: 'Empregada Doméstica', precisa_bater_ponto: 1, permite_hora_extra: 1, permite_dia_extra: 0, valor_hora_extra: 25, valor_dia_extra: 0, recebe_vale_transporte: 1, valor_vale_transporte: 0, recebe_vale_refeicao: 0, valor_vale_refeicao: 0, recebe_ajuda_combustivel: 0, valor_ajuda_combustivel: 0, dorme_no_local: 1, dias_dormida: 5, tipo_dias_dormida: 'semana' },
    { nome: 'Cozinheira', precisa_bater_ponto: 1, permite_hora_extra: 1, permite_dia_extra: 0, valor_hora_extra: 30, valor_dia_extra: 0, recebe_vale_transporte: 1, valor_vale_transporte: 0, recebe_vale_refeicao: 0, valor_vale_refeicao: 0, recebe_ajuda_combustivel: 0, valor_ajuda_combustivel: 0, dorme_no_local: 0, dias_dormida: 0, tipo_dias_dormida: 'semana' },
    { nome: 'Assistente Pessoal', precisa_bater_ponto: 0, permite_hora_extra: 0, permite_dia_extra: 0, valor_hora_extra: 0, valor_dia_extra: 0, recebe_vale_transporte: 1, valor_vale_transporte: 0, recebe_vale_refeicao: 1, valor_vale_refeicao: 40, recebe_ajuda_combustivel: 0, valor_ajuda_combustivel: 0, dorme_no_local: 0, dias_dormida: 0, tipo_dias_dormida: 'semana' },
    { nome: 'Jardineiro', precisa_bater_ponto: 1, permite_hora_extra: 0, permite_dia_extra: 1, valor_hora_extra: 0, valor_dia_extra: 250, recebe_vale_transporte: 1, valor_vale_transporte: 0, recebe_vale_refeicao: 1, valor_vale_refeicao: 30, recebe_ajuda_combustivel: 0, valor_ajuda_combustivel: 0, dorme_no_local: 0, dias_dormida: 0, tipo_dias_dormida: 'semana' },
  ];

  const insertCargo = db.prepare(`
    INSERT OR IGNORE INTO cargos (nome, precisa_bater_ponto, permite_hora_extra, permite_dia_extra, valor_hora_extra, valor_dia_extra, recebe_vale_transporte, valor_vale_transporte, recebe_vale_refeicao, valor_vale_refeicao, recebe_ajuda_combustivel, valor_ajuda_combustivel, dorme_no_local, dias_dormida, tipo_dias_dormida)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const c of cargos) {
    insertCargo.run(c.nome, c.precisa_bater_ponto, c.permite_hora_extra, c.permite_dia_extra, c.valor_hora_extra, c.valor_dia_extra, c.recebe_vale_transporte, c.valor_vale_transporte, c.recebe_vale_refeicao, c.valor_vale_refeicao, c.recebe_ajuda_combustivel, c.valor_ajuda_combustivel, c.dorme_no_local, c.dias_dormida, c.tipo_dias_dormida);
  }
}

module.exports = { db, initializeDatabase };
