const path = require('path');
const fs = require('fs');

// Create a unique test DB for each test suite
function createTestApp() {
  const testDbPath = path.join(__dirname, `test_${process.pid}_${Date.now()}.sqlite`);

  // Set env vars before requiring anything
  process.env.DB_PATH = testDbPath;
  process.env.JWT_SECRET = 'test-secret-key-for-testing-12345';
  process.env.JWT_EXPIRATION = '1h';
  process.env.NODE_ENV = 'test';
  process.env.PORT = '0'; // random port

  // Clear module cache to get fresh instances
  const keysToDelete = Object.keys(require.cache).filter(key =>
    key.includes('controle-ponto/src') || key.includes('controle-ponto/server')
  );
  keysToDelete.forEach(key => delete require.cache[key]);

  // Now require the app
  const { initializeDatabase, db } = require('../src/config/database');
  initializeDatabase();

  const app = require('../server');

  return { app, db, testDbPath };
}

// Seed default admin user
async function seedAdminUser(db) {
  const bcrypt = require('bcryptjs');
  const hashedPassword = await bcrypt.hash('admin123', 12);

  // Check if admin exists
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@test.com');
  if (!existing) {
    db.prepare(
      'INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, ?)'
    ).run('admin@test.com', hashedPassword, 'Admin Test', 'admin');
  }

  return { email: 'admin@test.com', password: 'admin123' };
}

async function seedViewerUser(db) {
  const bcrypt = require('bcryptjs');
  const hashedPassword = await bcrypt.hash('viewer123', 12);

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get('viewer@test.com');
  if (!existing) {
    db.prepare(
      'INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, ?)'
    ).run('viewer@test.com', hashedPassword, 'Viewer Test', 'viewer');
  }

  return { email: 'viewer@test.com', password: 'viewer123' };
}

async function seedGestorUser(db) {
  const bcrypt = require('bcryptjs');
  const hashedPassword = await bcrypt.hash('gestor123', 12);

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get('gestor@test.com');
  if (!existing) {
    db.prepare(
      'INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, ?)'
    ).run('gestor@test.com', hashedPassword, 'Gestor Test', 'gestor');
  }

  return { email: 'gestor@test.com', password: 'gestor123' };
}

function seedFuncionario(db) {
  const existing = db.prepare('SELECT id FROM funcionarios WHERE nome = ?').get('Test Employee');
  if (existing) return existing.id;

  const result = db.prepare(
    'INSERT INTO funcionarios (nome, cargo, salario_hora, telefone) VALUES (?, ?, ?, ?)'
  ).run('Test Employee', 'Developer', 50.0, '11999990000');
  return result.lastInsertRowid;
}

async function getAuthToken(app, credentials) {
  const request = require('supertest');
  const res = await request(app)
    .post('/api/auth/login')
    .send(credentials);
  return res.body.token;
}

function cleanup(testDbPath) {
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
    if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
  } catch (e) {
    // ignore cleanup errors
  }
}

module.exports = {
  createTestApp,
  seedAdminUser,
  seedViewerUser,
  seedGestorUser,
  seedFuncionario,
  getAuthToken,
  cleanup
};
