const request = require('supertest');
const { createTestApp, seedAdminUser, seedFuncionario, getAuthToken, cleanup } = require('./setup');

let app, db, testDbPath, adminToken, funcId;

beforeAll(async () => {
  ({ app, db, testDbPath } = createTestApp());
  const adminCreds = await seedAdminUser(db);
  adminToken = await getAuthToken(app, adminCreds);
  funcId = seedFuncionario(db);

  // Seed some records for reporting
  db.prepare(
    'INSERT INTO registros (funcionario_id, data, entrada, saida, tipo, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(funcId, '2025-01-06', '08:00', '17:00', 'manual', 1);
  db.prepare(
    'INSERT INTO registros (funcionario_id, data, entrada, saida, tipo, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(funcId, '2025-01-07', '08:00', '18:30', 'manual', 1);
  db.prepare(
    'INSERT INTO registros (funcionario_id, data, entrada, saida, tipo, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(funcId, '2025-01-08', '09:00', '17:00', 'manual', 1);
});

afterAll(() => {
  if (db && db.open) db.close();
  cleanup(testDbPath);
});

describe('GET /api/relatorios/mensal', () => {
  it('should return monthly report', async () => {
    const res = await request(app)
      .get('/api/relatorios/mensal?mes=1&ano=2025')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.mes).toBe(1);
    expect(res.body.ano).toBe(2025);
    expect(res.body.diasUteis).toBeDefined();
    expect(Array.isArray(res.body.funcionarios)).toBe(true);
  });

  it('should filter by employee', async () => {
    const res = await request(app)
      .get(`/api/relatorios/mensal?mes=1&ano=2025&funcionarioId=${funcId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.funcionarios.length).toBeGreaterThan(0);
    expect(res.body.funcionarios[0].nome).toBe('Test Employee');
  });

  it('should reject missing parameters', async () => {
    const res = await request(app)
      .get('/api/relatorios/mensal')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/relatorios/diario', () => {
  it('should return daily report', async () => {
    const res = await request(app)
      .get('/api/relatorios/diario?data=2025-01-06')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBe('2025-01-06');
    expect(res.body.tipoDia).toBeDefined();
    expect(Array.isArray(res.body.registros)).toBe(true);
  });
});

describe('GET /api/relatorios/funcionario/:id', () => {
  it('should return employee report', async () => {
    const res = await request(app)
      .get(`/api/relatorios/funcionario/${funcId}?mes=1&ano=2025`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.funcionario.nome).toBe('Test Employee');
    expect(res.body.resumo.totalHorasTrabalhadas).toBeGreaterThan(0);
  });

  it('should return 404 for non-existent employee', async () => {
    const res = await request(app)
      .get('/api/relatorios/funcionario/999?mes=1&ano=2025')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/relatorios/comparativo', () => {
  it('should return comparative data', async () => {
    const res = await request(app)
      .get('/api/relatorios/comparativo?mes=1&ano=2025')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.employeeHours)).toBe(true);
    expect(Array.isArray(res.body.dailyTrend)).toBe(true);
    expect(res.body.distribution).toBeDefined();
    expect(res.body.distribution.normal).toBeDefined();
    expect(res.body.distribution.overtime).toBeDefined();
    expect(res.body.distribution.holiday).toBeDefined();
  });

  it('should have employee hours data', async () => {
    const res = await request(app)
      .get('/api/relatorios/comparativo?mes=1&ano=2025')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.employeeHours.length).toBeGreaterThan(0);
    expect(res.body.employeeHours[0].nome).toBe('Test Employee');
    expect(res.body.employeeHours[0].horasTrabalhadas).toBeGreaterThan(0);
  });

  it('should have daily trend data', async () => {
    const res = await request(app)
      .get('/api/relatorios/comparativo?mes=1&ano=2025')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.dailyTrend.length).toBe(3);
  });
});
