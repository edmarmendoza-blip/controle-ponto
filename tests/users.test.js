const request = require('supertest');
const { createTestApp, seedAdminUser, seedViewerUser, seedGestorUser, getAuthToken, cleanup } = require('./setup');

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

describe('POST /api/auth/users (create user)', () => {
  it('should create a viewer user', async () => {
    const res = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'newviewer@test.com', password: 'pass123', name: 'New Viewer', role: 'viewer' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  it('should create a gestor user', async () => {
    const res = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'newgestor@test.com', password: 'pass123', name: 'New Gestor', role: 'gestor' });
    expect(res.status).toBe(201);
  });

  it('should reject duplicate email', async () => {
    const res = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'newviewer@test.com', password: 'pass123', name: 'Duplicate', role: 'viewer' });
    expect(res.status).toBe(409);
  });

  it('should reject invalid role', async () => {
    const res = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'bad@test.com', password: 'pass123', name: 'Bad', role: 'superadmin' });
    expect(res.status).toBe(400);
  });

  it('should reject short password', async () => {
    const res = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'short@test.com', password: '12', name: 'Short', role: 'viewer' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/auth/users/:id (update user)', () => {
  it('should update user role', async () => {
    // Get users list to find the viewer user ID
    const listRes = await request(app)
      .get('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`);
    const viewerUser = listRes.body.find(u => u.email === 'newviewer@test.com');

    const res = await request(app)
      .put(`/api/auth/users/${viewerUser.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'gestor', name: 'Updated Viewer' });
    expect(res.status).toBe(200);
  });

  it('should update user password', async () => {
    const listRes = await request(app)
      .get('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`);
    const viewerUser = listRes.body.find(u => u.email === 'newviewer@test.com');

    const res = await request(app)
      .put(`/api/auth/users/${viewerUser.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: 'newpass456' });
    expect(res.status).toBe(200);

    // Verify login with new password
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'newviewer@test.com', password: 'newpass456' });
    expect(loginRes.status).toBe(200);
  });

  it('should return 404 for non-existent user', async () => {
    const res = await request(app)
      .put('/api/auth/users/999')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Nope' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/auth/users/:id (deactivate user)', () => {
  it('should deactivate a user', async () => {
    const listRes = await request(app)
      .get('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`);
    const gestorUser = listRes.body.find(u => u.email === 'newgestor@test.com');

    const res = await request(app)
      .delete(`/api/auth/users/${gestorUser.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    // Verify can't login
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'newgestor@test.com', password: 'pass123' });
    expect(loginRes.status).toBe(401);
  });

  it('should not allow self-deletion', async () => {
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);
    const res = await request(app)
      .delete(`/api/auth/users/${meRes.body.user.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/auth/audit-log', () => {
  it('should return audit logs', async () => {
    const res = await request(app)
      .get('/api/auth/audit-log')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(res.body.total).toBeDefined();
    expect(res.body.page).toBeDefined();
  });

  it('should filter by entity type', async () => {
    const res = await request(app)
      .get('/api/auth/audit-log?entityType=user')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    res.body.logs.forEach(log => {
      expect(log.entity_type).toBe('user');
    });
  });

  it('should deny viewer access', async () => {
    await seedViewerUser(db);
    const viewerToken = await getAuthToken(app, { email: 'viewer@test.com', password: 'viewer123' });
    const res = await request(app)
      .get('/api/auth/audit-log')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });
});

describe('Gestor role permissions', () => {
  let gestorToken;

  beforeAll(async () => {
    // Create a new active gestor
    await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'activegestor@test.com', password: 'pass123', name: 'Active Gestor', role: 'gestor' });
    gestorToken = await getAuthToken(app, { email: 'activegestor@test.com', password: 'pass123' });
  });

  it('gestor can create employees', async () => {
    const res = await request(app)
      .post('/api/funcionarios')
      .set('Authorization', `Bearer ${gestorToken}`)
      .send({ nome: 'Gestor Created', cargo: 'Test', salario_hora: 20.0 });
    expect(res.status).toBe(201);
  });

  it('gestor cannot manage users', async () => {
    const res = await request(app)
      .get('/api/auth/users')
      .set('Authorization', `Bearer ${gestorToken}`);
    expect(res.status).toBe(403);
  });

  it('gestor cannot view audit log', async () => {
    const res = await request(app)
      .get('/api/auth/audit-log')
      .set('Authorization', `Bearer ${gestorToken}`);
    expect(res.status).toBe(403);
  });
});
