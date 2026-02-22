# Dashboard de Presença - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a new "Presença" page with real-time attendance status and historical attendance charts (assiduity rate, heatmap calendar, ranking).

**Architecture:** New API endpoints in Express backend calculate attendance data (present/absent/late) using SQL queries against `registros` and `funcionarios` tables. Frontend renders the page in the existing SPA (`app.js`) using Chart.js and HTML tables. A new `horario_entrada` column on `funcionarios` enables per-employee lateness tracking.

**Tech Stack:** Node.js/Express, better-sqlite3, Chart.js, Bootstrap 5, Vanilla JS SPA

---

### Task 1: Database Migration — Add `horario_entrada` column

**Files:**
- Modify: `src/config/database.js:39-47` (migration block)
- Modify: `src/config/database.js:62-72` (CREATE TABLE funcionarios)

**Step 1: Add migration for existing databases**

In `src/config/database.js`, inside the `try` block (after the geolocation migration at line 44), add:

```javascript
    // Add horario_entrada to funcionarios
    const funcCols = db.prepare("PRAGMA table_info(funcionarios)").all().map(c => c.name);
    if (funcCols.length > 0 && !funcCols.includes('horario_entrada')) {
      db.exec("ALTER TABLE funcionarios ADD COLUMN horario_entrada TEXT DEFAULT '08:00'");
    }
```

**Step 2: Update CREATE TABLE to include column for fresh databases**

In `src/config/database.js`, update the `CREATE TABLE IF NOT EXISTS funcionarios` block to add `horario_entrada TEXT DEFAULT '08:00'` after the `status` column (before `created_at`):

```sql
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
```

**Step 3: Run the app briefly to verify migration works**

Run: `cd /home/claude/controle-ponto && node -e "const {initializeDatabase} = require('./src/config/database'); initializeDatabase(); console.log('OK');"`
Expected: `OK` with no errors

**Step 4: Commit**

```bash
git add src/config/database.js
git commit -m "feat: add horario_entrada column to funcionarios table"
```

---

### Task 2: Update Funcionario Model — CRUD for `horario_entrada`

**Files:**
- Modify: `src/models/Funcionario.js:13` (create method)
- Modify: `src/models/Funcionario.js:23` (update allowed fields)

**Step 1: Update create method**

Change the `create` method to accept and insert `horario_entrada`:

```javascript
  static create({ nome, cargo, salario_hora, telefone, foto, status = 'ativo', horario_entrada = '08:00' }) {
    const result = db.prepare(
      'INSERT INTO funcionarios (nome, cargo, salario_hora, telefone, foto, status, horario_entrada) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(nome, cargo, salario_hora, telefone || null, foto || null, status, horario_entrada);
    return result.lastInsertRowid;
  }
```

**Step 2: Update allowed fields in update method**

Change line 23 from:
```javascript
    const allowed = ['nome', 'cargo', 'salario_hora', 'telefone', 'foto', 'status'];
```
to:
```javascript
    const allowed = ['nome', 'cargo', 'salario_hora', 'telefone', 'foto', 'status', 'horario_entrada'];
```

**Step 3: Commit**

```bash
git add src/models/Funcionario.js
git commit -m "feat: support horario_entrada in Funcionario model"
```

---

### Task 3: Update Funcionarios Route — Validation for `horario_entrada`

**Files:**
- Modify: `src/routes/funcionarios.js:59-63` (POST validation)
- Modify: `src/routes/funcionarios.js:80-84` (PUT validation)

**Step 1: Add validation to POST route**

After the `body('telefone')` validator in the POST route (line 63), add:

```javascript
  body('horario_entrada').optional().matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Horário de entrada inválido (HH:MM)')
```

**Step 2: Add validation to PUT route**

After `body('salario_hora')` in the PUT route (line 84), add:

```javascript
  body('horario_entrada').optional().matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Horário de entrada inválido (HH:MM)')
```

**Step 3: Commit**

```bash
git add src/routes/funcionarios.js
git commit -m "feat: add horario_entrada validation to funcionarios routes"
```

---

### Task 4: Write test for presença API — today endpoint

**Files:**
- Create: `tests/dashboardPresenca.test.js`

**Step 1: Write the test file**

```javascript
const request = require('supertest');
const { createTestApp, seedAdminUser, seedFuncionario, getAuthToken, cleanup } = require('./setup');

let app, db, testDbPath, adminToken, funcId;

beforeAll(async () => {
  ({ app, db, testDbPath } = createTestApp());
  const adminCreds = await seedAdminUser(db);
  adminToken = await getAuthToken(app, adminCreds);
  funcId = seedFuncionario(db);
});

afterAll(() => {
  if (db && db.open) db.close();
  cleanup(testDbPath);
});

describe('GET /api/dashboard/presenca/hoje', () => {
  it('should return today attendance summary', async () => {
    const today = new Date().toISOString().split('T')[0];

    // Create a record for today
    db.prepare(
      'INSERT INTO registros (funcionario_id, data, entrada, created_by) VALUES (?, ?, ?, ?)'
    ).run(funcId, today, '08:00', 1);

    const res = await request(app)
      .get('/api/dashboard/presenca/hoje')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBe(today);
    expect(res.body.resumo).toBeDefined();
    expect(res.body.resumo.total).toBeGreaterThanOrEqual(1);
    expect(res.body.resumo.presentes).toBeGreaterThanOrEqual(1);
    expect(res.body.funcionarios).toBeInstanceOf(Array);
    expect(res.body.funcionarios.length).toBeGreaterThanOrEqual(1);

    const func = res.body.funcionarios.find(f => f.id === funcId);
    expect(func).toBeDefined();
    expect(func.entrada).toBe('08:00');
    expect(['presente', 'atrasado']).toContain(func.status);
  });

  it('should show absent employees', async () => {
    // Create a second employee with no records
    db.prepare(
      "INSERT INTO funcionarios (nome, cargo, salario_hora) VALUES (?, ?, ?)"
    ).run('Absent Employee', 'Tester', 30.0);

    const res = await request(app)
      .get('/api/dashboard/presenca/hoje')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.resumo.ausentes).toBeGreaterThanOrEqual(1);
    const absent = res.body.funcionarios.find(f => f.nome === 'Absent Employee');
    expect(absent.status).toBe('ausente');
  });

  it('should detect late employees', async () => {
    const today = new Date().toISOString().split('T')[0];

    // Create employee with early expected time and late arrival
    const result = db.prepare(
      "INSERT INTO funcionarios (nome, cargo, salario_hora, horario_entrada) VALUES (?, ?, ?, ?)"
    ).run('Late Employee', 'Cook', 40.0, '07:00');
    const lateId = result.lastInsertRowid;

    db.prepare(
      'INSERT INTO registros (funcionario_id, data, entrada, created_by) VALUES (?, ?, ?, ?)'
    ).run(lateId, today, '07:30', 1);

    const res = await request(app)
      .get('/api/dashboard/presenca/hoje')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const late = res.body.funcionarios.find(f => f.id === lateId);
    expect(late.status).toBe('atrasado');
    expect(late.minutos_atraso).toBe(30);
  });

  it('should require authentication', async () => {
    const res = await request(app).get('/api/dashboard/presenca/hoje');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/dashboard/presenca/mensal', () => {
  it('should return monthly attendance data', async () => {
    const now = new Date();
    const mes = now.getMonth() + 1;
    const ano = now.getFullYear();

    const res = await request(app)
      .get(`/api/dashboard/presenca/mensal?mes=${mes}&ano=${ano}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.mes).toBe(mes);
    expect(res.body.ano).toBe(ano);
    expect(res.body.diasUteis).toBeGreaterThan(0);
    expect(res.body.funcionarios).toBeInstanceOf(Array);
    expect(res.body.heatmap).toBeInstanceOf(Array);
    expect(res.body.ranking).toBeInstanceOf(Array);

    // Check employee data structure
    if (res.body.funcionarios.length > 0) {
      const func = res.body.funcionarios[0];
      expect(func).toHaveProperty('dias_trabalhados');
      expect(func).toHaveProperty('faltas');
      expect(func).toHaveProperty('atrasos');
      expect(func).toHaveProperty('taxa_assiduidade');
    }

    // Check ranking is sorted by taxa_assiduidade desc
    if (res.body.ranking.length > 1) {
      expect(res.body.ranking[0].taxa_assiduidade).toBeGreaterThanOrEqual(res.body.ranking[1].taxa_assiduidade);
    }
  });

  it('should validate mes and ano params', async () => {
    const res = await request(app)
      .get('/api/dashboard/presenca/mensal?mes=13&ano=2026')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
  });

  it('should require authentication', async () => {
    const res = await request(app).get('/api/dashboard/presenca/mensal?mes=1&ano=2026');
    expect(res.status).toBe(401);
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `cd /home/claude/controle-ponto && npx jest tests/dashboardPresenca.test.js --verbose`
Expected: FAIL — route not found (404s)

**Step 3: Commit**

```bash
git add tests/dashboardPresenca.test.js
git commit -m "test: add failing tests for dashboard presenca endpoints"
```

---

### Task 5: Create DashboardPresenca Model

**Files:**
- Create: `src/models/DashboardPresenca.js`

**Step 1: Write the model**

```javascript
const { db } = require('../config/database');
const FeriadosService = require('../services/feriados');

class DashboardPresenca {
  static getPresencaHoje(data) {
    const rows = db.prepare(`
      SELECT
        f.id,
        f.nome,
        f.cargo,
        f.horario_entrada,
        r.entrada,
        r.saida
      FROM funcionarios f
      LEFT JOIN registros r ON f.id = r.funcionario_id AND r.data = ?
      WHERE f.status = 'ativo'
      ORDER BY f.nome
    `).all(data);

    const funcionarios = rows.map(row => {
      let status = 'ausente';
      let minutos_atraso = 0;

      if (row.entrada) {
        if (row.saida) {
          status = 'saiu';
        } else {
          status = 'presente';
        }

        // Check lateness
        const esperado = row.horario_entrada || '08:00';
        if (row.entrada > esperado) {
          status = 'atrasado';
          const [eh, em] = esperado.split(':').map(Number);
          const [rh, rm] = row.entrada.split(':').map(Number);
          minutos_atraso = (rh * 60 + rm) - (eh * 60 + em);
        }
      }

      return {
        id: row.id,
        nome: row.nome,
        cargo: row.cargo,
        horario_esperado: row.horario_entrada || '08:00',
        entrada: row.entrada || null,
        saida: row.saida || null,
        status,
        minutos_atraso
      };
    });

    const resumo = {
      total: funcionarios.length,
      presentes: funcionarios.filter(f => f.status === 'presente').length,
      ausentes: funcionarios.filter(f => f.status === 'ausente').length,
      atrasados: funcionarios.filter(f => f.status === 'atrasado').length,
      sairam: funcionarios.filter(f => f.status === 'saiu').length
    };

    return { data, resumo, funcionarios };
  }

  static getPresencaMensal(mes, ano) {
    const diasUteis = FeriadosService.getWorkingDaysInMonth(mes, ano);
    const lastDay = new Date(ano, mes, 0).getDate();
    const dataInicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const dataFim = `${ano}-${String(mes).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const funcionariosAtivos = db.prepare(
      "SELECT id, nome, cargo, horario_entrada FROM funcionarios WHERE status = 'ativo' ORDER BY nome"
    ).all();

    const registros = db.prepare(`
      SELECT funcionario_id, data, entrada
      FROM registros
      WHERE data BETWEEN ? AND ?
    `).all(dataInicio, dataFim);

    // Index records by funcionario_id -> data
    const registroMap = {};
    for (const r of registros) {
      if (!registroMap[r.funcionario_id]) registroMap[r.funcionario_id] = {};
      registroMap[r.funcionario_id][r.data] = r;
    }

    // Build working days list
    const diasUteisList = [];
    for (let day = 1; day <= lastDay; day++) {
      const data = `${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayType = FeriadosService.getDayType(data);
      diasUteisList.push({ data, tipo: dayType.tipo });
    }

    const heatmap = [];
    const funcionariosData = funcionariosAtivos.map(func => {
      const esperado = func.horario_entrada || '08:00';
      let dias_trabalhados = 0;
      let faltas = 0;
      let atrasos = 0;
      let total_minutos_atraso = 0;

      for (const dia of diasUteisList) {
        const reg = registroMap[func.id]?.[dia.data];

        if (dia.tipo !== 'normal') {
          // Weekend/holiday
          heatmap.push({ data: dia.data, funcionario_id: func.id, status: dia.tipo });
          continue;
        }

        // Only count working days up to today
        if (dia.data > new Date().toISOString().split('T')[0]) {
          heatmap.push({ data: dia.data, funcionario_id: func.id, status: 'futuro' });
          continue;
        }

        if (reg && reg.entrada) {
          dias_trabalhados++;
          if (reg.entrada > esperado) {
            atrasos++;
            const [eh, em] = esperado.split(':').map(Number);
            const [rh, rm] = reg.entrada.split(':').map(Number);
            total_minutos_atraso += (rh * 60 + rm) - (eh * 60 + em);
            heatmap.push({ data: dia.data, funcionario_id: func.id, status: 'atrasado' });
          } else {
            heatmap.push({ data: dia.data, funcionario_id: func.id, status: 'presente' });
          }
        } else {
          faltas++;
          heatmap.push({ data: dia.data, funcionario_id: func.id, status: 'falta' });
        }
      }

      // Count working days up to today for accurate rate
      const today = new Date().toISOString().split('T')[0];
      const diasUteisPassados = diasUteisList.filter(d => d.tipo === 'normal' && d.data <= today).length;
      const taxa_assiduidade = diasUteisPassados > 0
        ? Math.round((dias_trabalhados / diasUteisPassados) * 10000) / 100
        : 0;

      return {
        id: func.id,
        nome: func.nome,
        cargo: func.cargo,
        dias_trabalhados,
        faltas,
        atrasos,
        taxa_assiduidade,
        media_minutos_atraso: atrasos > 0 ? Math.round(total_minutos_atraso / atrasos) : 0
      };
    });

    // Ranking sorted by taxa_assiduidade DESC
    const ranking = [...funcionariosData]
      .sort((a, b) => b.taxa_assiduidade - a.taxa_assiduidade)
      .map((f, i) => ({
        id: f.id,
        nome: f.nome,
        cargo: f.cargo,
        taxa_assiduidade: f.taxa_assiduidade,
        dias_trabalhados: f.dias_trabalhados,
        faltas: f.faltas,
        posicao: i + 1
      }));

    return {
      mes: parseInt(mes),
      ano: parseInt(ano),
      diasUteis,
      funcionarios: funcionariosData,
      heatmap,
      ranking
    };
  }
}

module.exports = DashboardPresenca;
```

**Step 2: Commit**

```bash
git add src/models/DashboardPresenca.js
git commit -m "feat: add DashboardPresenca model with attendance calculations"
```

---

### Task 6: Create Dashboard Presença Route

**Files:**
- Create: `src/routes/dashboardPresenca.js`
- Modify: `server.js:55` (add route mount)

**Step 1: Write the route file**

```javascript
const express = require('express');
const { query, validationResult } = require('express-validator');
const DashboardPresenca = require('../models/DashboardPresenca');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/dashboard/presenca/hoje
router.get('/hoje', authenticateToken, (req, res) => {
  try {
    const data = new Date().toISOString().split('T')[0];
    const result = DashboardPresenca.getPresencaHoje(data);
    res.json(result);
  } catch (err) {
    console.error('Dashboard presenca hoje error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/dashboard/presenca/mensal
router.get('/mensal', authenticateToken, [
  query('mes').isInt({ min: 1, max: 12 }).withMessage('Mês inválido (1-12)'),
  query('ano').isInt({ min: 2020, max: 2099 }).withMessage('Ano inválido')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { mes, ano } = req.query;
    const result = DashboardPresenca.getPresencaMensal(mes, ano);
    res.json(result);
  } catch (err) {
    console.error('Dashboard presenca mensal error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
```

**Step 2: Mount the route in server.js**

In `server.js`, after line 55 (`app.use('/api/whatsapp', ...)`), add:

```javascript
app.use('/api/dashboard/presenca', require('./src/routes/dashboardPresenca'));
```

**Step 3: Run the tests to verify they pass**

Run: `cd /home/claude/controle-ponto && npx jest tests/dashboardPresenca.test.js --verbose`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/routes/dashboardPresenca.js server.js
git commit -m "feat: add dashboard presença API endpoints"
```

---

### Task 7: Run all tests to verify no regressions

**Step 1: Run the full test suite**

Run: `cd /home/claude/controle-ponto && npx jest --verbose --runInBand --forceExit`
Expected: All existing tests PASS, plus new dashboard tests PASS

**Step 2: Fix any failures if needed**

If existing tests fail, investigate and fix before continuing.

---

### Task 8: Frontend — Add menu item and page routing

**Files:**
- Modify: `public/index.html:78-83` (add menu item before Gráficos)
- Modify: `public/js/app.js:214-230` (add case to renderPage switch)

**Step 1: Add sidebar menu item in `public/index.html`**

After the "Relatórios" menu item (line 78) and before the "Gráficos" menu item (line 79), add:

```html
          <li>
            <a href="#" data-page="presenca">
              <i class="bi bi-calendar-check"></i><span>Presença</span>
            </a>
          </li>
```

**Step 2: Add case to renderPage in `public/js/app.js`**

In the `renderPage` switch statement (around line 224), add a case for 'presenca' after the 'graficos' case:

```javascript
      case 'presenca': renderPresenca(); break;
```

**Step 3: Commit**

```bash
git add public/index.html public/js/app.js
git commit -m "feat: add presença menu item and page routing"
```

---

### Task 9: Frontend — Render Presença page (cards + table + charts)

**Files:**
- Modify: `public/js/app.js` (add `renderPresenca()` and `loadPresencaData()` functions)

**Step 1: Add the renderPresenca function**

Add after the `renderGraficos` function block (after the closing of `loadGraficos` around line 1339). Add before the WhatsApp section comment:

```javascript
  // ============================================================
  // PRESENÇA
  // ============================================================
  async function renderPresenca() {
    const content = document.getElementById('page-content');
    const now = new Date();
    const mesAtual = now.getMonth() + 1;
    const anoAtual = now.getFullYear();

    content.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-4">
        <h4 class="mb-0"><i class="bi bi-calendar-check me-2"></i>Dashboard de Presença</h4>
      </div>

      <!-- Cards resumo do dia -->
      <div id="presenca-cards" class="row g-3 mb-4">
        <div class="loading-spinner"><div class="spinner-border text-primary"></div></div>
      </div>

      <!-- Tabela do dia -->
      <div class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center">
          <h5 class="mb-0"><i class="bi bi-clock me-2"></i>Status de Hoje</h5>
        </div>
        <div class="card-body p-0">
          <div id="presenca-tabela-hoje" class="table-responsive">
            <div class="loading-spinner p-4"><div class="spinner-border text-primary"></div></div>
          </div>
        </div>
      </div>

      <!-- Filtros mensais -->
      <div class="filter-bar mb-4">
        <div>
          <label class="form-label">Mês</label>
          <select class="form-select" id="presenca-mes">
            ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => `<option value="${m}" ${m === mesAtual ? 'selected' : ''}>${monthName(m)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="form-label">Ano</label>
          <input type="number" class="form-control" id="presenca-ano" value="${anoAtual}" min="2020" max="2099">
        </div>
        <div>
          <button class="btn btn-primary" onclick="App.loadPresencaMensal()">
            <i class="bi bi-search"></i> Atualizar
          </button>
        </div>
      </div>

      <!-- Gráfico de assiduidade -->
      <div class="row g-4 mb-4">
        <div class="col-lg-8">
          <div class="chart-container">
            <h5 class="mb-3"><i class="bi bi-bar-chart me-2"></i>Taxa de Assiduidade por Funcionário</h5>
            <div class="chart-canvas-wrapper"><canvas id="chart-assiduidade"></canvas></div>
          </div>
        </div>
        <div class="col-lg-4">
          <div class="card">
            <div class="card-header"><h5 class="mb-0"><i class="bi bi-trophy me-2"></i>Ranking de Assiduidade</h5></div>
            <div class="card-body p-0" id="presenca-ranking">
              <div class="loading-spinner p-4"><div class="spinner-border text-primary"></div></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Heatmap -->
      <div class="card mb-4">
        <div class="card-header"><h5 class="mb-0"><i class="bi bi-grid-3x3 me-2"></i>Calendário de Presença</h5></div>
        <div class="card-body p-0">
          <div id="presenca-heatmap" class="table-responsive">
            <div class="loading-spinner p-4"><div class="spinner-border text-primary"></div></div>
          </div>
        </div>
      </div>`;

    // Load today data
    loadPresencaHoje();
    // Load monthly data
    loadPresencaMensal();
  }

  async function loadPresencaHoje() {
    try {
      const data = await api('/api/dashboard/presenca/hoje');

      // Cards
      document.getElementById('presenca-cards').innerHTML = `
        <div class="col-6 col-md-3">
          <div class="stat-card stat-primary">
            <div class="stat-icon"><i class="bi bi-people"></i></div>
            <div class="stat-value">${data.resumo.total}</div>
            <div class="stat-label">Total</div>
          </div>
        </div>
        <div class="col-6 col-md-3">
          <div class="stat-card stat-success">
            <div class="stat-icon"><i class="bi bi-check-circle"></i></div>
            <div class="stat-value">${data.resumo.presentes + data.resumo.sairam}</div>
            <div class="stat-label">Presentes</div>
          </div>
        </div>
        <div class="col-6 col-md-3">
          <div class="stat-card stat-danger">
            <div class="stat-icon"><i class="bi bi-x-circle"></i></div>
            <div class="stat-value">${data.resumo.ausentes}</div>
            <div class="stat-label">Ausentes</div>
          </div>
        </div>
        <div class="col-6 col-md-3">
          <div class="stat-card stat-warning">
            <div class="stat-icon"><i class="bi bi-exclamation-triangle"></i></div>
            <div class="stat-value">${data.resumo.atrasados}</div>
            <div class="stat-label">Atrasados</div>
          </div>
        </div>`;

      // Table
      const statusBadge = (status) => {
        const map = {
          presente: '<span class="badge bg-success">Presente</span>',
          atrasado: '<span class="badge bg-warning text-dark">Atrasado</span>',
          ausente: '<span class="badge bg-danger">Ausente</span>',
          saiu: '<span class="badge bg-info">Saiu</span>'
        };
        return map[status] || status;
      };

      if (data.funcionarios.length === 0) {
        document.getElementById('presenca-tabela-hoje').innerHTML = '<div class="empty-state"><i class="bi bi-people"></i><p>Nenhum funcionário ativo</p></div>';
        return;
      }

      document.getElementById('presenca-tabela-hoje').innerHTML = `
        <table class="table table-hover mb-0">
          <thead>
            <tr>
              <th>Funcionário</th>
              <th>Cargo</th>
              <th>Horário Esperado</th>
              <th>Entrada</th>
              <th>Saída</th>
              <th>Status</th>
              <th>Atraso</th>
            </tr>
          </thead>
          <tbody>
            ${data.funcionarios.map(f => `
              <tr>
                <td><strong>${f.nome}</strong></td>
                <td>${f.cargo}</td>
                <td>${f.horario_esperado}</td>
                <td>${f.entrada || '-'}</td>
                <td>${f.saida || '-'}</td>
                <td>${statusBadge(f.status)}</td>
                <td>${f.minutos_atraso > 0 ? f.minutos_atraso + ' min' : '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`;
    } catch (err) {
      document.getElementById('presenca-cards').innerHTML = `<div class="alert alert-danger">Erro: ${err.message}</div>`;
    }
  }

  async function loadPresencaMensal() {
    const mes = document.getElementById('presenca-mes')?.value;
    const ano = document.getElementById('presenca-ano')?.value;
    if (!mes || !ano) return;

    try {
      const data = await api(`/api/dashboard/presenca/mensal?mes=${mes}&ano=${ano}`);

      destroyCharts();

      // Bar Chart: Assiduidade
      const barCtx = document.getElementById('chart-assiduidade');
      if (barCtx && data.funcionarios.length > 0) {
        const colors = data.funcionarios.map(f =>
          f.taxa_assiduidade >= 90 ? 'rgba(34, 197, 94, 0.7)' :
          f.taxa_assiduidade >= 70 ? 'rgba(245, 158, 11, 0.7)' :
          'rgba(239, 68, 68, 0.7)'
        );
        const borderColors = data.funcionarios.map(f =>
          f.taxa_assiduidade >= 90 ? 'rgba(34, 197, 94, 1)' :
          f.taxa_assiduidade >= 70 ? 'rgba(245, 158, 11, 1)' :
          'rgba(239, 68, 68, 1)'
        );

        const chart = new Chart(barCtx, {
          type: 'bar',
          data: {
            labels: data.funcionarios.map(f => f.nome),
            datasets: [{
              label: 'Taxa de Assiduidade (%)',
              data: data.funcionarios.map(f => f.taxa_assiduidade),
              backgroundColor: colors,
              borderColor: borderColors,
              borderWidth: 1
            }]
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { min: 0, max: 100, title: { display: true, text: '%' } }
            }
          }
        });
        chartInstances.push(chart);
      }

      // Ranking
      if (data.ranking.length > 0) {
        const medalha = (pos) => {
          if (pos === 1) return '<span style="font-size:1.2em">&#129351;</span>';
          if (pos === 2) return '<span style="font-size:1.2em">&#129352;</span>';
          if (pos === 3) return '<span style="font-size:1.2em">&#129353;</span>';
          return `<span class="badge bg-secondary">${pos}</span>`;
        };

        const barColor = (taxa) =>
          taxa >= 90 ? 'bg-success' : taxa >= 70 ? 'bg-warning' : 'bg-danger';

        document.getElementById('presenca-ranking').innerHTML = `
          <ul class="list-group list-group-flush">
            ${data.ranking.map(r => `
              <li class="list-group-item d-flex align-items-center gap-2">
                ${medalha(r.posicao)}
                <div class="flex-grow-1">
                  <div class="fw-bold">${r.nome}</div>
                  <div class="small text-muted">${r.cargo} &middot; ${r.dias_trabalhados}/${data.diasUteis} dias</div>
                  <div class="progress mt-1" style="height: 6px;">
                    <div class="progress-bar ${barColor(r.taxa_assiduidade)}" style="width: ${r.taxa_assiduidade}%"></div>
                  </div>
                </div>
                <span class="fw-bold">${r.taxa_assiduidade}%</span>
              </li>
            `).join('')}
          </ul>`;
      } else {
        document.getElementById('presenca-ranking').innerHTML = '<div class="p-3 text-muted text-center">Sem dados</div>';
      }

      // Heatmap as HTML table
      if (data.heatmap.length > 0) {
        const funcIds = [...new Set(data.heatmap.map(h => h.funcionario_id))];
        const funcNames = {};
        data.funcionarios.forEach(f => funcNames[f.id] = f.nome);

        const daysInMonth = new Date(ano, mes, 0).getDate();
        const days = Array.from({length: daysInMonth}, (_, i) => i + 1);

        const heatmapMap = {};
        data.heatmap.forEach(h => {
          const day = parseInt(h.data.split('-')[2]);
          heatmapMap[`${h.funcionario_id}-${day}`] = h.status;
        });

        const cellColor = (status) => {
          const map = {
            presente: 'background-color: rgba(34, 197, 94, 0.6)',
            atrasado: 'background-color: rgba(245, 158, 11, 0.6)',
            falta: 'background-color: rgba(239, 68, 68, 0.6)',
            feriado: 'background-color: rgba(156, 163, 175, 0.3)',
            domingo: 'background-color: rgba(156, 163, 175, 0.3)',
            sabado: 'background-color: rgba(156, 163, 175, 0.3)',
            futuro: 'background-color: rgba(229, 231, 235, 0.3)'
          };
          return map[status] || '';
        };

        const cellTitle = (status) => {
          const map = {
            presente: 'Presente',
            atrasado: 'Atrasado',
            falta: 'Falta',
            feriado: 'Feriado',
            domingo: 'Domingo',
            sabado: 'Sábado',
            futuro: '-'
          };
          return map[status] || '';
        };

        document.getElementById('presenca-heatmap').innerHTML = `
          <table class="table table-sm table-bordered mb-0 text-center" style="font-size: 0.75rem;">
            <thead>
              <tr>
                <th class="text-start" style="min-width:120px">Funcionário</th>
                ${days.map(d => `<th style="padding:2px 4px">${d}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${funcIds.map(fid => `
                <tr>
                  <td class="text-start text-nowrap"><strong>${funcNames[fid] || fid}</strong></td>
                  ${days.map(d => {
                    const status = heatmapMap[`${fid}-${d}`] || '';
                    return `<td style="${cellColor(status)};padding:2px 4px" title="${cellTitle(status)}">&nbsp;</td>`;
                  }).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="d-flex gap-3 p-2 small text-muted flex-wrap">
            <span><span style="display:inline-block;width:12px;height:12px;background:rgba(34,197,94,0.6);border-radius:2px"></span> Presente</span>
            <span><span style="display:inline-block;width:12px;height:12px;background:rgba(245,158,11,0.6);border-radius:2px"></span> Atrasado</span>
            <span><span style="display:inline-block;width:12px;height:12px;background:rgba(239,68,68,0.6);border-radius:2px"></span> Falta</span>
            <span><span style="display:inline-block;width:12px;height:12px;background:rgba(156,163,175,0.3);border-radius:2px"></span> Fim de semana/Feriado</span>
          </div>`;
      } else {
        document.getElementById('presenca-heatmap').innerHTML = '<div class="empty-state"><i class="bi bi-grid-3x3"></i><p>Nenhum dado para o período</p></div>';
      }

    } catch (err) {
      showToast('Erro ao carregar dados mensais: ' + err.message, 'danger');
    }
  }
```

**Step 2: Expose loadPresencaMensal in the App object**

Find the `window.App = {` object at the bottom of `app.js` and add `loadPresencaMensal` to it. Search for `loadGraficos` in the App object and add `loadPresencaMensal` next to it.

**Step 3: Commit**

```bash
git add public/js/app.js
git commit -m "feat: add presença dashboard frontend page with charts and heatmap"
```

---

### Task 10: Frontend — Add CSS for heatmap and stat cards

**Files:**
- Modify: `public/css/style.css`

**Step 1: Check if stat-card styles already exist**

Search for `stat-card` in `style.css`. If they already exist (from the existing dashboard), the new page will reuse them. If not, add:

```css
/* Presença heatmap */
#presenca-heatmap .table th,
#presenca-heatmap .table td {
  vertical-align: middle;
}

#presenca-heatmap .table td[title]:hover {
  opacity: 0.8;
  cursor: default;
}
```

**Step 2: Commit**

```bash
git add public/css/style.css
git commit -m "feat: add presença heatmap styles"
```

---

### Task 11: Frontend — Update funcionário forms to include `horario_entrada`

**Files:**
- Modify: `public/js/app.js` — the modal forms in `renderFuncionarios()`

**Step 1: Find the create/edit employee modal HTML**

Search for the employee create modal in `renderFuncionarios`. Add a `horario_entrada` field to both the create and edit forms. The field should appear after `telefone`:

```html
<div class="mb-3">
  <label class="form-label">Horário de Entrada</label>
  <input type="time" class="form-control" id="func-horario-entrada" value="${func?.horario_entrada || '08:00'}">
</div>
```

**Step 2: Update the JS that reads the form values**

When creating/updating an employee, include `horario_entrada` from the form input in the API call body.

**Step 3: Update the employee table to show the field**

Add a "Horário" column to the employees table header and data rows.

**Step 4: Commit**

```bash
git add public/js/app.js
git commit -m "feat: add horario_entrada field to employee forms"
```

---

### Task 12: Run full test suite and manual verification

**Step 1: Run all tests**

Run: `cd /home/claude/controle-ponto && npx jest --verbose --runInBand --forceExit`
Expected: ALL tests pass

**Step 2: Quick verification — start the server**

Run: `cd /home/claude/controle-ponto && timeout 5 node server.js 2>&1 || true`
Expected: Server starts without errors, prints port message

**Step 3: Final commit if anything was adjusted**

```bash
git add -A
git commit -m "feat: complete dashboard de presença implementation"
```
