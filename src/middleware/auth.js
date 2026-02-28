const jwt = require('jsonwebtoken');
const { db } = require('../config/database');

// In-memory token blacklist (for logout invalidation)
// Map<token, expiryTimestamp> — auto-cleaned every 30 min
const _tokenBlacklist = new Map();
let _lastBlacklistCleanup = 0;

function blacklistToken(token) {
  try {
    const decoded = jwt.decode(token);
    const exp = decoded && decoded.exp ? decoded.exp * 1000 : Date.now() + 24 * 60 * 60 * 1000;
    _tokenBlacklist.set(token, exp);
  } catch (e) {
    // If decode fails, blacklist with 24h expiry
    _tokenBlacklist.set(token, Date.now() + 24 * 60 * 60 * 1000);
  }
}

function isTokenBlacklisted(token) {
  // Periodic cleanup (every 30 min)
  const now = Date.now();
  if (now - _lastBlacklistCleanup > 30 * 60 * 1000) {
    _lastBlacklistCleanup = now;
    for (const [t, exp] of _tokenBlacklist) {
      if (exp < now) _tokenBlacklist.delete(t);
    }
  }
  return _tokenBlacklist.has(token);
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token de acesso não fornecido' });
  }

  if (isTokenBlacklisted(token)) {
    return res.status(401).json({ error: 'Token invalidado (logout)' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.prepare('SELECT id, email, name, role, active, pode_criar_tarefas, pode_criar_tarefas_whatsapp FROM users WHERE id = ?').get(decoded.userId);

    if (!user || !user.active) {
      return res.status(401).json({ error: 'Usuário não encontrado ou inativo' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado' });
    }
    return res.status(403).json({ error: 'Token inválido' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito a administradores' });
  }
  next();
}

function requireGestor(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'gestor') {
    return res.status(403).json({ error: 'Acesso restrito a administradores e gestores' });
  }
  next();
}

module.exports = { authenticateToken, requireAdmin, requireGestor, blacklistToken };
