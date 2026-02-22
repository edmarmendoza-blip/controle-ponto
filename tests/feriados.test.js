const request = require('supertest');
const { createTestApp, seedAdminUser, seedViewerUser, getAuthToken, cleanup } = require('./setup');

let app, db, testDbPath, adminToken, viewerToken;

beforeAll(async () => {
  ({ app, db, testDbPath } = createTestApp());
  const adminCreds = await seedAdminUser(db);
  adminToken = await getAuthToken(app, adminCreds);
  await seedViewerUser(db);
  viewerToken = await getAuthToken(app, { email: 'viewer@test.com', password: 'viewer123' });
});

afterAll(() => {
  if (db && db.open) db.close();
  cleanup(testDbPath);
});

describe('POST /api/feriados', () => {
  it('should create a holiday (admin)', async () => {
    const res = await request(app)
      .post('/api/feriados')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        data: '2025-01-01',
        descricao: 'Ano Novo',
        tipo: 'nacional',
        ano: 2025
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  it('should reject viewer creating holiday', async () => {
    const res = await request(app)
      .post('/api/feriados')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({
        data: '2025-04-21',
        descricao: 'Tiradentes',
        tipo: 'nacional',
        ano: 2025
      });
    expect(res.status).toBe(403);
  });

  it('should reject invalid tipo', async () => {
    const res = await request(app)
      .post('/api/feriados')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        data: '2025-12-25',
        descricao: 'Natal',
        tipo: 'invalid',
        ano: 2025
      });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/feriados', () => {
  it('should list holidays', async () => {
    const res = await request(app)
      .get('/api/feriados')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('should filter by year', async () => {
    const res = await request(app)
      .get('/api/feriados?ano=2025')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    res.body.forEach(f => expect(f.ano).toBe(2025));
  });
});

describe('GET /api/feriados/:id', () => {
  it('should get holiday by id', async () => {
    const res = await request(app)
      .get('/api/feriados/1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.descricao).toBe('Ano Novo');
  });

  it('should return 404 for non-existent', async () => {
    const res = await request(app)
      .get('/api/feriados/999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/feriados/:id', () => {
  it('should update a holiday', async () => {
    const res = await request(app)
      .put('/api/feriados/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ descricao: 'Confraternização Universal' });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/feriados/:id', () => {
  it('should delete a holiday', async () => {
    // Create one to delete
    const createRes = await request(app)
      .post('/api/feriados')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ data: '2025-09-07', descricao: 'Independência', tipo: 'nacional', ano: 2025 });

    const res = await request(app)
      .delete(`/api/feriados/${createRes.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/feriados/sync-status', () => {
  it('should return sync status', async () => {
    const res = await request(app)
      .get('/api/feriados/sync-status')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('lastSync');
  });
});
