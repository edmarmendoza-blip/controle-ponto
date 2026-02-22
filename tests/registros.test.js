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

describe('POST /api/registros', () => {
  it('should create a new record', async () => {
    const res = await request(app)
      .post('/api/registros')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        funcionario_id: funcId,
        data: '2025-01-15',
        entrada: '08:00',
        saida: '17:00',
        observacao: 'Normal day'
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  it('should create record with geolocation', async () => {
    const res = await request(app)
      .post('/api/registros')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        funcionario_id: funcId,
        data: '2025-01-16',
        entrada: '08:00',
        saida: '17:00',
        latitude: -23.5505,
        longitude: -46.6333
      });
    expect(res.status).toBe(201);
  });

  it('should reject duplicate records', async () => {
    const res = await request(app)
      .post('/api/registros')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        funcionario_id: funcId,
        data: '2025-01-15',
        entrada: '08:00'
      });
    expect(res.status).toBe(409);
  });

  it('should reject invalid time format', async () => {
    const res = await request(app)
      .post('/api/registros')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        funcionario_id: funcId,
        data: '2025-01-17',
        entrada: '25:00'
      });
    expect(res.status).toBe(400);
  });

  it('should reject non-existent employee', async () => {
    const res = await request(app)
      .post('/api/registros')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        funcionario_id: 9999,
        data: '2025-01-17',
        entrada: '08:00'
      });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/registros', () => {
  it('should get records by date', async () => {
    const res = await request(app)
      .get('/api/registros?data=2025-01-15')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('should get records by date range', async () => {
    const res = await request(app)
      .get('/api/registros?dataInicio=2025-01-01&dataFim=2025-01-31')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('should filter by employee', async () => {
    const res = await request(app)
      .get(`/api/registros?data=2025-01-15&funcionarioId=${funcId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe('GET /api/registros/:id', () => {
  it('should get record by id', async () => {
    const res = await request(app)
      .get('/api/registros/1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.funcionario_nome).toBeDefined();
  });

  it('should include geolocation fields', async () => {
    const res = await request(app)
      .get('/api/registros/2')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.latitude).toBeDefined();
    expect(res.body.longitude).toBeDefined();
  });
});

describe('PUT /api/registros/:id', () => {
  it('should update a record', async () => {
    const res = await request(app)
      .put('/api/registros/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ saida: '18:00' });
    expect(res.status).toBe(200);
  });

  it('should update geolocation', async () => {
    const res = await request(app)
      .put('/api/registros/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ latitude: -22.9068, longitude: -43.1729 });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/registros/:id', () => {
  it('should delete a record (admin)', async () => {
    // Create one to delete
    const createRes = await request(app)
      .post('/api/registros')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ funcionario_id: funcId, data: '2025-01-20', entrada: '09:00' });

    const res = await request(app)
      .delete(`/api/registros/${createRes.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/registros/dashboard', () => {
  it('should return dashboard summary', async () => {
    const res = await request(app)
      .get('/api/registros/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
