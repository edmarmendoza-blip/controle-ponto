const request = require('supertest');
const { createTestApp, seedAdminUser, seedViewerUser, getAuthToken, cleanup } = require('./setup');

let app, db, testDbPath, adminToken;

beforeAll(async () => {
  ({ app, db, testDbPath } = createTestApp());
  const adminCreds = await seedAdminUser(db);
  adminToken = await getAuthToken(app, adminCreds);
});

afterAll(() => {
  if (db && db.open) db.close();
  cleanup(testDbPath);
});

describe('POST /api/funcionarios', () => {
  it('should create a new employee', async () => {
    const res = await request(app)
      .post('/api/funcionarios')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'John Doe', cargo: 'Developer', salario_hora: 50.0, telefone: '11999999999' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  it('should reject missing required fields', async () => {
    const res = await request(app)
      .post('/api/funcionarios')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'Test' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/funcionarios', () => {
  it('should list active employees', async () => {
    const res = await request(app)
      .get('/api/funcionarios')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('should include inactive with flag', async () => {
    const res = await request(app)
      .get('/api/funcionarios?includeInactive=true')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/funcionarios/:id', () => {
  it('should get employee by id', async () => {
    const res = await request(app)
      .get('/api/funcionarios/1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.nome).toBe('John Doe');
  });

  it('should return 404 for non-existent', async () => {
    const res = await request(app)
      .get('/api/funcionarios/999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/funcionarios/:id', () => {
  it('should update employee', async () => {
    const res = await request(app)
      .put('/api/funcionarios/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cargo: 'Senior Developer' });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/funcionarios/search', () => {
  it('should search employees by name', async () => {
    const res = await request(app)
      .get('/api/funcionarios/search?q=John')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe('DELETE /api/funcionarios/:id', () => {
  it('should soft delete (deactivate) employee', async () => {
    // Create one to delete
    const createRes = await request(app)
      .post('/api/funcionarios')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'To Delete', cargo: 'Test', salario_hora: 10.0 });

    const res = await request(app)
      .delete(`/api/funcionarios/${createRes.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    // Verify deactivated
    const getRes = await request(app)
      .get(`/api/funcionarios/${createRes.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.body.status).toBe('inativo');
  });
});
