const { db } = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
  static findByEmail(email) {
    return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  }

  static findById(id) {
    return db.prepare('SELECT id, email, name, role, active, created_at FROM users WHERE id = ?').get(id);
  }

  static async create({ email, password, name, role = 'viewer' }) {
    const hashedPassword = await bcrypt.hash(password, 12);
    const result = db.prepare(
      'INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, ?)'
    ).run(email, hashedPassword, name, role);
    return result.lastInsertRowid;
  }

  static async validatePassword(plainPassword, hashedPassword) {
    return bcrypt.compare(plainPassword, hashedPassword);
  }

  static getAll() {
    return db.prepare('SELECT id, email, name, role, active, created_at FROM users ORDER BY name').all();
  }

  static update(id, data) {
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(data)) {
      if (['name', 'role', 'active', 'email'].includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    if (fields.length === 0) return null;
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    return db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }
}

module.exports = User;
