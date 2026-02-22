const request = require('supertest');
const { createTestApp, seedAdminUser, seedViewerUser, seedGestorUser, getAuthToken, cleanup } = require('./setup');

let app, db, testDbPath, adminToken, adminCreds;

beforeAll(async () => {
  ({ app, db, testDbPath } = createTestApp());
  adminCreds = await seedAdminUser(db);
  adminToken = await getAuthToken(app, adminCreds);
});

afterAll(() => {
  if (db && db.open) db.close();
  cleanup(testDbPath);
});

describe('POST /api/auth/login', () => {
  it('should login with valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send(adminCreds);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe('admin@test.com');
    expect(res.body.user.role).toBe('admin');
  });

  it('should reject invalid password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('should reject unknown email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'unknown@test.com', password: 'test' });
    expect(res.status).toBe(401);
  });

  it('should reject invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'notanemail', password: 'test' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/auth/me', () => {
  it('should return current user', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('admin@test.com');
  });

  it('should reject without token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('should reject invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalidtoken');
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/auth/password', () => {
  it('should change password', async () => {
    const res = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ currentPassword: 'admin123', newPassword: 'newpass123' });
    expect(res.status).toBe(200);

    // Change back
    const newToken = await getAuthToken(app, { email: 'admin@test.com', password: 'newpass123' });
    await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${newToken}`)
      .send({ currentPassword: 'newpass123', newPassword: 'admin123' });
  });

  it('should reject wrong current password', async () => {
    const res = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ currentPassword: 'wrongpass', newPassword: 'newpass123' });
    expect(res.status).toBe(401);
  });
});

describe('Role enforcement', () => {
  let viewerToken;

  beforeAll(async () => {
    await seedViewerUser(db);
    viewerToken = await getAuthToken(app, { email: 'viewer@test.com', password: 'viewer123' });
  });

  it('should deny viewer access to admin endpoints', async () => {
    const res = await request(app)
      .get('/api/auth/users')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });

  it('should deny viewer creating users', async () => {
    const res = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ email: 'new@test.com', password: 'pass123', name: 'New', role: 'viewer' });
    expect(res.status).toBe(403);
  });

  it('should allow admin to list users', async () => {
    const res = await request(app)
      .get('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
