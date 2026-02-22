require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const bcrypt = require('bcryptjs');
const { db, initializeDatabase } = require('./database');

async function seed() {
  console.log('Initializing database...');
  initializeDatabase();

  // Create admin user
  const hashedPassword = await bcrypt.hash('Admin@2026!', 12);
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (email, password, name, role) VALUES (?, ?, ?, ?)
  `);
  insertUser.run('admin@casadosbull.com', hashedPassword, 'Administrador', 'admin');
  console.log('Admin user created: admin@casadosbull.com');

  // Feriados de São Paulo 2026
  const feriados2026 = [
    ['2026-01-01', 'Confraternização Universal', 'nacional'],
    ['2026-01-25', 'Aniversário de São Paulo', 'municipal'],
    ['2026-02-16', 'Carnaval (ponto facultativo)', 'facultativo'],
    ['2026-02-17', 'Carnaval', 'nacional'],
    ['2026-04-03', 'Sexta-feira Santa', 'nacional'],
    ['2026-04-21', 'Tiradentes', 'nacional'],
    ['2026-05-01', 'Dia do Trabalho', 'nacional'],
    ['2026-06-19', 'Corpus Christi', 'nacional'],
    ['2026-07-09', 'Revolução Constitucionalista', 'estadual'],
    ['2026-09-07', 'Independência', 'nacional'],
    ['2026-10-12', 'Nossa Sra. Aparecida', 'nacional'],
    ['2026-11-02', 'Finados', 'nacional'],
    ['2026-11-15', 'Proclamação da República', 'nacional'],
    ['2026-11-20', 'Consciência Negra', 'municipal'],
    ['2026-12-25', 'Natal', 'nacional']
  ];

  const insertFeriado = db.prepare(`
    INSERT OR IGNORE INTO feriados (data, descricao, tipo, ano) VALUES (?, ?, ?, 2026)
  `);

  const deleteExisting = db.prepare('DELETE FROM feriados WHERE ano = 2026');
  deleteExisting.run();

  for (const [data, descricao, tipo] of feriados2026) {
    insertFeriado.run(data, descricao, tipo);
  }
  console.log('Feriados 2026 SP inserted: ' + feriados2026.length + ' records');

  // Sample employees
  const insertFunc = db.prepare(`
    INSERT OR IGNORE INTO funcionarios (nome, cargo, salario_hora, telefone, status)
    VALUES (?, ?, ?, ?, 'ativo')
  `);

  const funcionarios = [
    ['João Silva', 'Garçom', 18.50, '(11) 99999-0001'],
    ['Maria Santos', 'Caixa', 20.00, '(11) 99999-0002'],
    ['Pedro Oliveira', 'Cozinheiro', 22.00, '(11) 99999-0003'],
    ['Ana Costa', 'Garçonete', 18.50, '(11) 99999-0004'],
    ['Carlos Souza', 'Churrasqueiro', 25.00, '(11) 99999-0005']
  ];

  for (const [nome, cargo, salario, tel] of funcionarios) {
    insertFunc.run(nome, cargo, salario, tel);
  }
  console.log('Sample employees inserted: ' + funcionarios.length + ' records');

  console.log('Seed completed successfully!');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
