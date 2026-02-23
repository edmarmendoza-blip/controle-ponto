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

    setInterval(async () => {
      try {
        await jobFn();
        console.log(`[Scheduler] ${name}: executado com sucesso`);
      } catch (err) {
        console.error(`[Scheduler] ${name}: erro -`, err.message);
      }
    }, ms);
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
    // Calculate previous month
    const now = new Date();
    let mes = now.getMonth(); // 0-indexed, so current month -1 = previous month (but getMonth already is 0-indexed)
    let ano = now.getFullYear();
    if (mes === 0) {
      mes = 12;
      ano--;
    }
    // mes is now 1-12 for previous month

    const funcionarios = Funcionario.getAll();
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
}

module.exports = Schedulers;
