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
