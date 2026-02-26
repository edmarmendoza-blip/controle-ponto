require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { db, initializeDatabase } = require('./database');

function seedRegistros() {
  console.log('Initializing database...');
  initializeDatabase();

  const funcs = db.prepare("SELECT id, nome FROM funcionarios WHERE status = 'ativo'").all();
  if (funcs.length === 0) {
    console.log('No active employees found. Run "npm run seed" first.');
    process.exit(1);
  }
  console.log('Funcionários:', funcs.map(f => f.nome).join(', '));

  const insert = db.prepare(
    'INSERT OR IGNORE INTO registros (funcionario_id, data, entrada, saida, tipo, created_by) VALUES (?, ?, ?, ?, ?, 1)'
  );

  const now = new Date();
  const mes = now.getMonth() + 1;
  const ano = now.getFullYear();
  const lastDay = new Date(ano, mes, 0).getDate();
  const todayStr = now.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

  let count = 0;
  for (let day = 1; day <= lastDay; day++) {
    const data = `${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (data > todayStr) break;

    const date = new Date(data + 'T12:00:00');
    const dow = date.getDay();
    if (dow === 0 || dow === 6) continue;

    for (const func of funcs) {
      const rand = Math.random();
      const isToday = data === todayStr;

      // Different attendance patterns per employee
      const patterns = {
        'Maria Santos':     { absentRate: 0,    lateRate: 0,   maxLateMin: 0  },
        'Carlos Souza':     { absentRate: 0.05, lateRate: 0.2, maxLateMin: 5  },
        'João Silva':       { absentRate: 0.15, lateRate: 0.4, maxLateMin: 20 },
        'Pedro Oliveira':   { absentRate: 0.1,  lateRate: 0.6, maxLateMin: 30 },
        'Ana Costa':        { absentRate: 0.25, lateRate: 0.1, maxLateMin: 10 },
      };

      const p = patterns[func.nome] || { absentRate: 0.1, lateRate: 0.3, maxLateMin: 15 };

      if (rand < p.absentRate) continue;

      const isLate = Math.random() < p.lateRate;
      const lateMin = isLate ? Math.floor(Math.random() * p.maxLateMin) + 1 : 0;
      const totalMin = 8 * 60 + lateMin;
      const entradaH = String(Math.floor(totalMin / 60)).padStart(2, '0');
      const entradaM = String(totalMin % 60).padStart(2, '0');
      const entrada = entradaH === '08' ? `08:${entradaM}` : '08:00';
      const saida = isToday ? null : '17:00';

      try {
        insert.run(func.id, data, entrada, saida, 'manual');
        count++;
      } catch (e) {
        // duplicate, skip
      }
    }
  }

  console.log(`Registros inseridos: ${count} (${String(mes).padStart(2, '0')}/${ano})`);
  process.exit(0);
}

seedRegistros();
