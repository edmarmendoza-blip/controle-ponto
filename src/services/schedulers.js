const { db } = require('../config/database');
const EmailService = require('./emailService');
const Funcionario = require('../models/Funcionario');
const Registro = require('../models/Registro');
const HorasExtrasService = require('./horasExtras');

class Schedulers {
  // Schedule a job at a specific time daily
  static _scheduleDaily(name, hour, minute, jobFn) {
    function scheduleNext() {
      const now = new Date();
      const next = new Date(now);
      next.setHours(hour, minute, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      const ms = next - now;

      console.log(`[Scheduler] ${name}: próxima execução em ${Math.round(ms / 60000)} min`);
      setTimeout(async () => {
        try {
          await jobFn();
          console.log(`[Scheduler] ${name}: executado com sucesso`);
        } catch (err) {
          console.error(`[Scheduler] ${name}: erro -`, err.message);
        }
        scheduleNext();
      }, ms);
    }
    scheduleNext();
  }

  // Schedule a job at specific time on day 1 of each month
  static _scheduleMonthly(name, day, hour, minute, jobFn) {
    function scheduleNext() {
      const now = new Date();
      let next = new Date(now.getFullYear(), now.getMonth(), day, hour, minute, 0);
      if (next <= now) {
        next = new Date(now.getFullYear(), now.getMonth() + 1, day, hour, minute, 0);
      }
      const ms = next - now;

      console.log(`[Scheduler] ${name}: próxima execução em ${Math.round(ms / 3600000)}h`);
      setTimeout(async () => {
        try {
          await jobFn();
          console.log(`[Scheduler] ${name}: executado com sucesso`);
        } catch (err) {
          console.error(`[Scheduler] ${name}: erro -`, err.message);
        }
        scheduleNext();
      }, ms);
    }
    scheduleNext();
  }

  // Store interval IDs for cleanup
  static _intervalIds = [];

  // Schedule a job every N hours
  static _scheduleInterval(name, intervalHours, jobFn) {
    const ms = intervalHours * 3600000;
    console.log(`[Scheduler] ${name}: executando a cada ${intervalHours}h`);

    // Run once on startup after 30s delay
    setTimeout(async () => {
      try {
        await jobFn();
        console.log(`[Scheduler] ${name}: execução inicial concluída`);
      } catch (err) {
        console.error(`[Scheduler] ${name}: erro inicial -`, err.message);
      }
    }, 30000);

    const id = setInterval(async () => {
      try {
        await jobFn();
        console.log(`[Scheduler] ${name}: executado com sucesso`);
      } catch (err) {
        console.error(`[Scheduler] ${name}: erro -`, err.message);
      }
    }, ms);
    this._intervalIds.push(id);
  }

  // Schedule a job every N minutes
  static _scheduleIntervalMinutes(name, intervalMinutes, jobFn, startupDelayMs = 60000) {
    const ms = intervalMinutes * 60000;
    console.log(`[Scheduler] ${name}: executando a cada ${intervalMinutes}min`);

    // Run once on startup after delay
    setTimeout(async () => {
      try {
        await jobFn();
        console.log(`[Scheduler] ${name}: execução inicial concluída`);
      } catch (err) {
        console.error(`[Scheduler] ${name}: erro inicial -`, err.message);
      }
    }, startupDelayMs);

    const id = setInterval(async () => {
      try {
        await jobFn();
      } catch (err) {
        console.error(`[Scheduler] ${name}: erro -`, err.message);
      }
    }, ms);
    this._intervalIds.push(id);
  }

  // Schedule a job at specific time on a specific day of week (0=Sunday, 5=Friday)
  static _scheduleWeekly(name, dayOfWeek, hour, minute, jobFn) {
    function scheduleNext() {
      const now = new Date();
      let next = new Date(now);
      next.setHours(hour, minute, 0, 0);
      // Calculate days until target day
      const currentDay = now.getDay();
      let daysUntil = dayOfWeek - currentDay;
      if (daysUntil < 0 || (daysUntil === 0 && next <= now)) {
        daysUntil += 7;
      }
      next.setDate(next.getDate() + daysUntil);
      const ms = next - now;

      console.log(`[Scheduler] ${name}: próxima execução em ${Math.round(ms / 3600000)}h`);
      setTimeout(async () => {
        try {
          await jobFn();
          console.log(`[Scheduler] ${name}: executado com sucesso`);
        } catch (err) {
          console.error(`[Scheduler] ${name}: erro -`, err.message);
        }
        scheduleNext();
      }, ms);
    }
    scheduleNext();
  }

  // Cleanup all intervals (for graceful shutdown / hot-reload)
  static destroy() {
    this._intervalIds.forEach(id => clearInterval(id));
    this._intervalIds = [];
  }

  // Initialize all schedulers
  static init() {
    console.log('[Scheduler] Inicializando schedulers...');

    // 1. Vacation alerts - daily at 08:00
    this._scheduleDaily('Alertas de Férias', 8, 0, () => this.checkVacationAlerts());

    // 2. Monthly closing email - day 1 at 08:00
    this._scheduleMonthly('Fechamento Mensal', 1, 8, 0, () => this.sendMonthlyClosing());

    // 3. IMAP holerite sync - every 6 hours
    this._scheduleInterval('Sync Holerites IMAP', 6, () => this.syncHolerites());

    // 4. WhatsApp health check - every 20 minutes (production only)
    if (process.env.DB_PATH && !process.env.DB_PATH.includes('sandbox')) {
      this._scheduleIntervalMinutes('WhatsApp Health Check', 20, () => this.checkWhatsAppHealth(), 120000);
    } else {
      console.log('[Scheduler] WhatsApp Health Check: desativado no sandbox');
    }

    // 5. Weekly summary via WhatsApp - Tuesday at 18:00
    this._scheduleWeekly('Resumo Semanal WhatsApp', 2, 18, 0, () => this.sendWeeklySummary());

    // 6. Absence alert - daily at 09:30 (checks employees who didn't register entry)
    this._scheduleDaily('Alerta de Ausência', 9, 30, () => this.checkAbsences());

    // 7. Prestador frequency alert - daily at 20:00 (fixed prestadores who didn't show up)
    this._scheduleDaily('Alerta Prestadores', 20, 0, () => this.checkPrestadorFrequency());

    console.log('[Scheduler] Todos os schedulers iniciados');
  }

  // Feature 18: Check vacation alerts
  static async checkVacationAlerts() {
    const funcionarios = Funcionario.getAll();
    const today = new Date();
    const alerts = [];

    for (const func of funcionarios) {
      if (!func.ferias_inicio || !func.ferias_fim) continue;

      const inicio = new Date(func.ferias_inicio + 'T00:00:00');
      const fim = new Date(func.ferias_fim + 'T00:00:00');
      const daysUntilStart = Math.ceil((inicio - today) / 86400000);
      const daysUntilEnd = Math.ceil((fim - today) / 86400000);

      // Alert 7, 3, 1 days before vacation starts
      if ([7, 3, 1].includes(daysUntilStart)) {
        alerts.push({
          nome: func.nome,
          tipo: 'início',
          dias: daysUntilStart,
          data: func.ferias_inicio
        });

        // Notify employee
        if (func.notificacoes_ativas && func.email_pessoal) {
          await EmailService.sendVacationNotification(func, 'lembrete');
        }
      }

      // Alert when vacation ends today
      if (daysUntilEnd === 0) {
        alerts.push({
          nome: func.nome,
          tipo: 'retorno',
          dias: 0,
          data: func.ferias_fim
        });

        if (func.notificacoes_ativas && func.email_pessoal) {
          await EmailService.sendVacationNotification(func, 'finalizada');
        }
      }

      // Auto-update vacation status
      if (daysUntilStart <= 0 && daysUntilEnd > 0 && func.ferias_status !== 'em_ferias') {
        db.prepare('UPDATE funcionarios SET ferias_status = ? WHERE id = ?').run('em_ferias', func.id);
      }
      if (daysUntilEnd <= 0 && func.ferias_status === 'em_ferias') {
        db.prepare('UPDATE funcionarios SET ferias_status = ? WHERE id = ?').run('concluidas', func.id);
      }
    }

    // Send admin summary if there are alerts
    if (alerts.length > 0) {
      const rows = alerts.map(a =>
        `<tr>
          <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${a.nome}</td>
          <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${a.tipo === 'início' ? `Começa em ${a.dias} dia(s)` : 'Retorna hoje'}</td>
          <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${a.data}</td>
        </tr>`
      ).join('');

      await EmailService.sendAlert('vacation_alert', 'Alertas de Férias', `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#059669;color:white;padding:20px;border-radius:8px 8px 0 0;">
            <h2 style="margin:0;">Alertas de Férias</h2>
          </div>
          <div style="padding:20px;background:#f8fafc;border-radius:0 0 8px 8px;">
            <table style="width:100%;border-collapse:collapse;">
              <thead><tr style="background:#f1f5f9;">
                <th style="padding:10px;text-align:left;">Funcionário</th>
                <th style="padding:10px;text-align:left;">Status</th>
                <th style="padding:10px;text-align:left;">Data</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      `);
    }

    return alerts;
  }

  // Feature 19: Monthly closing email (day 1)
  static async sendMonthlyClosing() {
    // Previous month (1-12)
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const mes = prev.getMonth() + 1;
    const ano = prev.getFullYear();

    const allFuncionarios = Funcionario.getAll();
    const funcionarios = allFuncionarios.filter(f => f.aparece_relatorios !== 0);
    const resultados = [];
    let totalHoras = 0;
    let totalExtras = 0;
    let totalPagar = 0;

    for (const func of funcionarios) {
      const registros = Registro.getMonthlyReport(mes, ano, func.id);
      const folha = HorasExtrasService.calcularFolha(registros, func);

      const diasTrab = folha.resumo.diasTrabalhados;
      const totalVT = func.recebe_vt ? Funcionario.calcularVT(func.id, diasTrab) : 0;
      const totalVA = func.tem_vale_alimentacao ? Math.round((func.valor_va_dia || 0) * diasTrab * 100) / 100 : 0;
      const totalGeral = Math.round((folha.resumo.totalMensal + totalVT + totalVA) * 100) / 100;

      const horasNorm = folha.resumo.totalHorasTrabalhadas - folha.resumo.totalHorasExtras;

      resultados.push({
        nome: func.nome,
        diasTrabalhados: diasTrab,
        totalHorasNormais: horasNorm,
        totalHorasExtras: folha.resumo.totalHorasExtras,
        totalGeral
      });

      totalHoras += folha.resumo.totalHorasTrabalhadas;
      totalExtras += folha.resumo.totalHorasExtras;
      totalPagar += totalGeral;
    }

    totalHoras = Math.round(totalHoras * 100) / 100;
    totalExtras = Math.round(totalExtras * 100) / 100;
    totalPagar = Math.round(totalPagar * 100) / 100;

    await EmailService.sendMonthlyReport({
      mes,
      ano,
      funcionarios: resultados,
      totalHoras,
      totalExtras,
      totalPagar
    });

    return { mes, ano, funcionarios: resultados.length, totalPagar };
  }

  // WhatsApp health check - verify connection status, email if offline
  static async checkWhatsAppHealth() {
    const whatsappService = require('./whatsapp');
    const status = whatsappService.status;

    if (status === 'connected') {
      console.log('[Scheduler] WhatsApp Health: conectado ✓');
      return { status: 'connected', ok: true };
    }

    // Check if WhatsApp is enabled
    const config = db.prepare("SELECT valor FROM configuracoes WHERE chave = 'whatsapp_enabled'").get();
    if (!config || config.valor !== 'true') {
      console.log('[Scheduler] WhatsApp Health: serviço desabilitado (ignorando)');
      return { status: 'disabled', ok: true };
    }

    // WhatsApp is enabled but not connected - send alert
    console.warn(`[Scheduler] WhatsApp Health: OFFLINE (status: ${status})`);
    await EmailService.sendWhatsAppAlert(`Health check falhou - status: ${status}`);

    return { status, ok: false };
  }

  // IMAP holerite sync
  static async syncHolerites() {
    try {
      const HoleriteIMAP = require('./holeriteIMAP');
      const result = await HoleriteIMAP.sync();
      if (result.saved > 0) {
        console.log(`[Scheduler] Holerites: ${result.saved} novos salvos`);
      }
      return result;
    } catch (err) {
      console.error('[Scheduler] Holerites sync error:', err.message);
      return { success: false, error: err.message };
    }
  }

  // Weekly summary via WhatsApp (Tuesday 18:00)
  static async sendWeeklySummary() {
    try {
      const whatsappService = require('./whatsapp');
      if (!whatsappService.ready) {
        console.log('[Scheduler] Resumo semanal: WhatsApp não conectado, enviando por email');
        // Fallback to email below
      }

      // Get admin phone from users table
      const admin = db.prepare("SELECT telefone FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
      if (!admin || !admin.telefone) {
        console.log('[Scheduler] Resumo semanal: nenhum admin com telefone cadastrado');
        return { success: false, error: 'Admin sem telefone' };
      }

      // Calculate week range (Monday to today/Friday)
      const now = new Date();
      const today = now.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
      const dayOfWeek = now.getDay(); // 0=Sun, 5=Fri
      const daysBack = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // days since Monday
      const monday = new Date(now);
      monday.setDate(monday.getDate() - daysBack);
      const mondayStr = monday.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

      // 1. Attendance summary per employee
      const funcionarios = Funcionario.getAll().filter(f => f.precisa_bater_ponto === 1);
      const attendanceRows = [];
      let totalDias = 0;
      let totalHE = 0;

      for (const func of funcionarios) {
        const registros = db.prepare(
          `SELECT DISTINCT data FROM registros WHERE funcionario_id = ? AND data BETWEEN ? AND ? AND entrada IS NOT NULL`
        ).all(func.id, mondayStr, today);
        const diasPresente = registros.length;

        // Sum extra hours
        const extras = db.prepare(
          `SELECT SUM(CASE WHEN saida IS NOT NULL AND entrada IS NOT NULL
            THEN (CAST(substr(saida,1,2) AS REAL)*60 + CAST(substr(saida,4,2) AS REAL)) -
                 (CAST(substr(entrada,1,2) AS REAL)*60 + CAST(substr(entrada,4,2) AS REAL))
            ELSE 0 END) as total_min
          FROM registros WHERE funcionario_id = ? AND data BETWEEN ? AND ?`
        ).get(func.id, mondayStr, today);
        const totalMin = extras?.total_min || 0;
        const horasTrabalhadas = Math.round(totalMin / 60 * 10) / 10;

        attendanceRows.push({
          nome: func.nome,
          dias: diasPresente,
          horas: horasTrabalhadas
        });
        totalDias += diasPresente;
        totalHE += horasTrabalhadas;
      }

      // 2. Deliveries this week
      const entregas = db.prepare(
        `SELECT COUNT(*) as total FROM entregas WHERE data_recebimento BETWEEN ? AND ?`
      ).get(mondayStr, today);
      const entregasTotal = entregas?.total || 0;

      // 3. Low stock alerts
      const estoqueBaixo = db.prepare(
        `SELECT nome, quantidade_atual, quantidade_minima FROM estoque_itens
         WHERE ativo = 1 AND quantidade_atual <= quantidade_minima`
      ).all();

      // 4. Pending confirmations (expired this week)
      const expiradas = db.prepare(
        `SELECT COUNT(*) as total FROM pending_confirmations
         WHERE status = 'expired' AND created_at BETWEEN ? AND ?`
      ).get(mondayStr + ' 00:00:00', today + ' 23:59:59');
      const expiradasTotal = expiradas?.total || 0;

      // 5. Tasks completed this week
      const tarefasConcluidas = db.prepare(
        `SELECT COUNT(*) as total FROM tarefas
         WHERE status = 'concluida' AND updated_at BETWEEN ? AND ?`
      ).get(mondayStr, today + ' 23:59:59');
      const tarefasTotal = tarefasConcluidas?.total || 0;

      // 6. Prestadores visits this week
      let prestadorRows = [];
      try {
        prestadorRows = db.prepare(
          `SELECT p.nome, COUNT(v.id) as visitas,
             SUM(CASE WHEN v.data_saida IS NOT NULL THEN 1 ELSE 0 END) as completas
           FROM prestador_visitas v
           JOIN prestadores p ON v.prestador_id = p.id
           WHERE DATE(v.data_entrada) BETWEEN ? AND ?
           GROUP BY p.id ORDER BY visitas DESC`
        ).all(mondayStr, today);
      } catch (e) { /* table may not exist yet */ }

      // 7. Pending expenses
      let despesasPendentes = 0;
      let despesasValor = 0;
      try {
        const desp = db.prepare(
          `SELECT COUNT(*) as total, COALESCE(SUM(valor), 0) as valor
           FROM despesas WHERE status = 'pendente'`
        ).get();
        despesasPendentes = desp?.total || 0;
        despesasValor = desp?.valor || 0;
      } catch (e) { /* table may not exist */ }

      // 8. Unprocessed emails
      let emailsPendentes = 0;
      try {
        const emails = db.prepare(
          `SELECT COUNT(*) as total FROM email_inbox WHERE status = 'pendente'`
        ).get();
        emailsPendentes = emails?.total || 0;
      } catch (e) { /* table may not exist */ }

      // Format dates for display
      const formatBR = (d) => { const [y, m, day] = d.split('-'); return `${day}/${m}`; };

      // Build message
      let msg = `📊 *Resumo Semanal — ${formatBR(mondayStr)} a ${formatBR(today)}*\n\n`;

      msg += `👥 *Presença:*\n`;
      for (const row of attendanceRows) {
        const emoji = row.dias >= 5 ? '✅' : row.dias >= 3 ? '⚠️' : row.dias > 0 ? '🔶' : '❌';
        msg += `${emoji} ${row.nome}: ${row.dias} dia(s) — ${row.horas}h\n`;
      }

      if (entregasTotal > 0) {
        msg += `\n📦 *Entregas:* ${entregasTotal} recebida(s)\n`;
      }

      if (estoqueBaixo.length > 0) {
        msg += `\n⚠️ *Estoque baixo:*\n`;
        for (const item of estoqueBaixo) {
          msg += `• ${item.nome}: ${item.quantidade_atual}/${item.quantidade_minima}\n`;
        }
      }

      if (tarefasTotal > 0) {
        msg += `\n✅ *Tarefas concluídas:* ${tarefasTotal}\n`;
      }

      if (prestadorRows.length > 0) {
        msg += `\n🔧 *Prestadores:*\n`;
        for (const p of prestadorRows) {
          msg += `• ${p.nome}: ${p.visitas} visita(s) (${p.completas} completa(s))\n`;
        }
      }

      if (despesasPendentes > 0) {
        msg += `\n💰 *Despesas pendentes:* ${despesasPendentes} — R$ ${despesasValor.toFixed(2)}\n`;
      }

      if (emailsPendentes > 0) {
        msg += `\n📩 *Emails não processados:* ${emailsPendentes}\n`;
      }

      if (expiradasTotal > 0) {
        msg += `\n⏰ *${expiradasTotal} confirmação(ões) expiraram sem resposta*\n`;
      }

      msg += `\n_Lar Digital v${require('../../version.json').version}_`;

      // Send via WhatsApp DM to admin
      if (whatsappService.ready) {
        const sent = await whatsappService.sendPrivateMessage(admin.telefone, msg);
        if (sent) {
          console.log('[Scheduler] Resumo semanal enviado via WhatsApp');
          return { success: true, via: 'whatsapp' };
        }
      }

      // Fallback: send via email
      await EmailService.sendAlert('weekly_summary', 'Resumo Semanal — Lar Digital', msg.replace(/\n/g, '<br>').replace(/\*/g, ''));
      console.log('[Scheduler] Resumo semanal enviado via email (fallback)');
      return { success: true, via: 'email' };

    } catch (err) {
      console.error('[Scheduler] Resumo semanal error:', err.message);
      return { success: false, error: err.message };
    }
  }
  // G3: Check for absent employees and alert admin via WhatsApp
  static async checkAbsences() {
    try {
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
      const now = new Date();
      const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Sao_Paulo' });

      // Skip weekends
      if (dayOfWeek === 'Sat' || dayOfWeek === 'Sun') {
        console.log('[Scheduler] Alerta ausência: fim de semana, ignorando');
        return { skipped: true, reason: 'weekend' };
      }

      // Skip feriados
      const feriado = db.prepare(
        `SELECT id, descricao FROM feriados WHERE data = ?`
      ).get(today);
      if (feriado) {
        console.log(`[Scheduler] Alerta ausência: feriado (${feriado.descricao}), ignorando`);
        return { skipped: true, reason: 'feriado', descricao: feriado.descricao };
      }

      // Get employees who need to clock in (precisa_bater_ponto=1, active, with horario_entrada)
      const funcionarios = db.prepare(`
        SELECT f.id, f.nome, f.horario_entrada, f.telefone
        FROM funcionarios f
        JOIN cargos c ON f.cargo_id = c.id
        WHERE f.status = 'ativo'
          AND c.precisa_bater_ponto = 1
          AND c.aparece_relatorios = 1
          AND f.horario_entrada IS NOT NULL
          AND f.horario_entrada != ''
      `).all();

      if (funcionarios.length === 0) {
        console.log('[Scheduler] Alerta ausência: nenhum funcionário com horário de entrada');
        return { skipped: true, reason: 'no_employees' };
      }

      // Check who already registered entry today
      const registrosHoje = db.prepare(`
        SELECT DISTINCT funcionario_id
        FROM registros
        WHERE data = ? AND entrada IS NOT NULL
      `).all(today).map(r => r.funcionario_id);

      // Check who is on vacation
      const emFerias = db.prepare(`
        SELECT funcionario_id FROM ferias
        WHERE status = 'aprovada'
          AND data_inicio <= ? AND data_fim >= ?
      `).all(today, today).map(f => f.funcionario_id);

      // Current time in minutes for comparison
      const nowStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
      const [nowH, nowM] = nowStr.split(':').map(Number);
      const nowMinutes = nowH * 60 + nowM;

      // Filter absent employees (no entry + past their expected time + 15min tolerance)
      const TOLERANCE_MIN = 15;
      const ausentes = [];

      for (const func of funcionarios) {
        // Skip if already registered
        if (registrosHoje.includes(func.id)) continue;
        // Skip if on vacation
        if (emFerias.includes(func.id)) continue;

        // Parse expected entry time
        const [entH, entM] = func.horario_entrada.split(':').map(Number);
        const expectedMinutes = entH * 60 + entM;

        // Only alert if current time is past expected + tolerance
        if (nowMinutes >= expectedMinutes + TOLERANCE_MIN) {
          const atraso = nowMinutes - expectedMinutes;
          ausentes.push({
            id: func.id,
            nome: func.nome,
            horario_esperado: func.horario_entrada,
            atraso_min: atraso
          });
        }
      }

      if (ausentes.length === 0) {
        console.log('[Scheduler] Alerta ausência: todos presentes ou dentro do horário');
        return { ausentes: 0 };
      }

      // Build alert message
      let msg = `⚠️ *Alerta de Ausência — ${today.split('-').reverse().join('/')}*\n\n`;
      msg += `${ausentes.length} funcionário(s) sem registro de entrada:\n\n`;

      for (const a of ausentes) {
        const horas = Math.floor(a.atraso_min / 60);
        const mins = a.atraso_min % 60;
        const atrasoStr = horas > 0 ? `${horas}h${mins > 0 ? mins + 'min' : ''}` : `${mins}min`;
        msg += `❌ *${a.nome}*\n`;
        msg += `   Esperado: ${a.horario_esperado} (atraso: ${atrasoStr})\n\n`;
      }

      msg += `_Verifique no dashboard: ${process.env.APP_URL || 'https://lardigital.app'}_`;

      // Send via WhatsApp DM to admin
      const whatsappService = require('./whatsapp');
      const admin = db.prepare("SELECT telefone FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();

      if (whatsappService.ready && admin?.telefone) {
        const sent = await whatsappService.sendPrivateMessage(admin.telefone, msg);
        if (sent) {
          console.log(`[Scheduler] Alerta ausência: ${ausentes.length} ausente(s), enviado via WhatsApp`);
          return { ausentes: ausentes.length, via: 'whatsapp', funcionarios: ausentes };
        }
      }

      // Fallback: email
      const emailMsg = msg.replace(/\n/g, '<br>').replace(/\*/g, '<strong>').replace(/_/g, '<em>');
      await EmailService.sendAlert('absence_alert', `Alerta de Ausência — ${ausentes.length} funcionário(s)`, emailMsg);
      console.log(`[Scheduler] Alerta ausência: ${ausentes.length} ausente(s), enviado via email`);
      return { ausentes: ausentes.length, via: 'email', funcionarios: ausentes };

    } catch (err) {
      console.error('[Scheduler] Alerta ausência error:', err.message);
      return { success: false, error: err.message };
    }
  }
  // G4: Check prestador frequency — alert admin about fixed prestadores who didn't show up today
  static async checkPrestadorFrequency() {
    try {
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
      const dayOfWeek = new Date().getDay(); // 0=Sun, 6=Sat
      const dayNames = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
      const todayName = dayNames[dayOfWeek];

      // Get active fixed prestadores
      let prestadores;
      try {
        prestadores = db.prepare(
          `SELECT id, nome, frequencia_dias FROM prestadores WHERE tipo = 'fixo' AND ativo = 1 AND frequencia_dias IS NOT NULL`
        ).all();
      } catch (e) {
        console.log('[Scheduler] Alerta prestadores: tabela não existe ainda');
        return { skipped: true };
      }

      if (!prestadores || prestadores.length === 0) {
        console.log('[Scheduler] Alerta prestadores: nenhum prestador fixo cadastrado');
        return { skipped: true, reason: 'no_prestadores' };
      }

      const ausentes = [];
      for (const p of prestadores) {
        // Check if today is an expected day
        let dias;
        try { dias = JSON.parse(p.frequencia_dias); } catch (e) { continue; }
        if (!Array.isArray(dias) || !dias.includes(todayName)) continue;

        // Check if visited today
        const visita = db.prepare(
          `SELECT id FROM prestador_visitas WHERE prestador_id = ? AND DATE(data_entrada) = ?`
        ).get(p.id, today);
        if (!visita) {
          ausentes.push(p.nome);
        }
      }

      if (ausentes.length === 0) {
        console.log('[Scheduler] Alerta prestadores: todos os esperados compareceram');
        return { ausentes: 0 };
      }

      // Send WhatsApp alert to admin
      const whatsappService = require('./whatsapp');
      const admin = db.prepare("SELECT telefone FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();

      let msg = `🔧 *Alerta Prestadores — ${today.split('-').reverse().join('/')}*\n\n`;
      msg += `${ausentes.length} prestador(es) fixo(s) não compareceram hoje:\n\n`;
      for (const nome of ausentes) {
        msg += `❌ ${nome}\n`;
      }

      if (whatsappService.ready && admin?.telefone) {
        await whatsappService.sendPrivateMessage(admin.telefone, msg);
        console.log(`[Scheduler] Alerta prestadores: ${ausentes.length} ausente(s), enviado via WhatsApp`);
        return { ausentes: ausentes.length, via: 'whatsapp' };
      }

      // Fallback: email
      await EmailService.sendAlert('prestador_frequency', `Alerta Prestadores — ${ausentes.length} ausência(s)`, msg.replace(/\n/g, '<br>').replace(/\*/g, ''));
      console.log(`[Scheduler] Alerta prestadores: ${ausentes.length} ausente(s), enviado via email`);
      return { ausentes: ausentes.length, via: 'email' };
    } catch (err) {
      console.error('[Scheduler] Alerta prestadores error:', err.message);
      return { success: false, error: err.message };
    }
  }
}

module.exports = Schedulers;
