const nodemailer = require('nodemailer');

class EmailService {
  static _transporter = null;
  static _lastAlertTime = {};

  static getTransporter() {
    if (!this._transporter) {
      const host = process.env.SMTP_HOST || 'smtp.gmail.com';
      const port = parseInt(process.env.SMTP_PORT || '587');
      const user = process.env.SMTP_USER;
      const pass = process.env.SMTP_PASS;

      if (!user || !pass) {
        console.warn('[Email] SMTP_USER ou SMTP_PASS não configurados no .env');
        return null;
      }

      this._transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass }
      });
    }
    return this._transporter;
  }

  static async send({ to, subject, html, text }) {
    const transporter = this.getTransporter();
    if (!transporter) {
      console.warn('[Email] Transporter não configurado, email não enviado:', subject);
      return null;
    }

    const from = `"${process.env.APP_NAME || 'Lar Digital'}" <${process.env.SMTP_USER}>`;
    const result = await transporter.sendMail({ from, to, subject, html, text });
    console.log(`[Email] Enviado: ${subject} -> ${to}`);
    return result;
  }

  static async sendAlert(alertType, subject, html) {
    const to = process.env.ALERT_EMAIL_TO;
    if (!to) return null;

    // Rate limit: 1 alert per type per hour
    const now = Date.now();
    const lastSent = this._lastAlertTime[alertType] || 0;
    if (now - lastSent < 3600000) {
      console.log(`[Email] Alerta ${alertType} suprimido (rate limit 1h)`);
      return null;
    }
    this._lastAlertTime[alertType] = now;

    return this.send({ to, subject: `[Lar Digital] ${subject}`, html });
  }

  static async sendWelcome(funcionario) {
    const email = funcionario.email_pessoal;
    if (!email) return null;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1e40af; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0;">Bem-vindo(a) ao Lar Digital!</h1>
        </div>
        <div style="padding: 20px; background: #f8fafc; border-radius: 0 0 8px 8px;">
          <p>Olá <strong>${funcionario.nome}</strong>,</p>
          <p>Você foi cadastrado(a) no sistema de gestão <strong>Lar Digital</strong>.</p>
          <p><strong>Cargo:</strong> ${funcionario.cargo || 'Não informado'}</p>
          <p><strong>Início:</strong> ${funcionario.data_admissao || 'A definir'}</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0;">
          <p style="color: #64748b; font-size: 14px;">
            Seus registros de ponto serão feitos pelo WhatsApp do grupo.
            Qualquer dúvida, fale com a administração.
          </p>
        </div>
      </div>
    `;

    return this.send({
      to: email,
      subject: 'Bem-vindo(a) ao Lar Digital!',
      html
    });
  }

  static async sendVacationNotification(funcionario, tipo) {
    const email = funcionario.email_pessoal;
    if (!email) return null;

    const messages = {
      aprovada: {
        subject: 'Suas férias foram aprovadas!',
        body: `Suas férias foram agendadas de <strong>${funcionario.ferias_inicio}</strong> a <strong>${funcionario.ferias_fim}</strong>.`
      },
      lembrete: {
        subject: 'Lembrete: Suas férias começam em breve',
        body: `Suas férias começam em <strong>${funcionario.ferias_inicio}</strong>. Prepare-se!`
      },
      finalizada: {
        subject: 'Férias encerradas - Bem-vindo(a) de volta!',
        body: 'Suas férias terminaram. Bom retorno ao trabalho!'
      }
    };

    const msg = messages[tipo];
    if (!msg) return null;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #059669; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0;">Lar Digital - Férias</h2>
        </div>
        <div style="padding: 20px; background: #f8fafc; border-radius: 0 0 8px 8px;">
          <p>Olá <strong>${funcionario.nome}</strong>,</p>
          <p>${msg.body}</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0;">
          <p style="color: #64748b; font-size: 14px;">Lar Digital - Gestão da Casa</p>
        </div>
      </div>
    `;

    return this.send({ to: email, subject: `[Lar Digital] ${msg.subject}`, html });
  }

  static async sendMonthlyReport(reportData) {
    const to = process.env.ALERT_EMAIL_TO;
    if (!to) return null;

    const { mes, ano, funcionarios, totalHoras, totalExtras, totalPagar } = reportData;
    const meses = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    let tableRows = funcionarios.map(f => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${f.nome}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: center;">${f.diasTrabalhados}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">${f.totalHorasNormais}h</td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">${f.totalHorasExtras}h</td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">R$ ${f.totalGeral.toFixed(2)}</td>
      </tr>
    `).join('');

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
        <div style="background: #1e40af; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0;">Fechamento Mensal - ${meses[mes]}/${ano}</h1>
        </div>
        <div style="padding: 20px; background: #f8fafc;">
          <div style="display: flex; gap: 16px; margin-bottom: 20px;">
            <div style="background: white; padding: 16px; border-radius: 8px; flex: 1; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <div style="font-size: 24px; font-weight: bold; color: #1e40af;">${funcionarios.length}</div>
              <div style="color: #64748b;">Funcionários</div>
            </div>
            <div style="background: white; padding: 16px; border-radius: 8px; flex: 1; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <div style="font-size: 24px; font-weight: bold; color: #059669;">${totalHoras}h</div>
              <div style="color: #64748b;">Total Horas</div>
            </div>
            <div style="background: white; padding: 16px; border-radius: 8px; flex: 1; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <div style="font-size: 24px; font-weight: bold; color: #dc2626;">R$ ${totalPagar.toFixed(2)}</div>
              <div style="color: #64748b;">Total a Pagar</div>
            </div>
          </div>
          <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden;">
            <thead>
              <tr style="background: #f1f5f9;">
                <th style="padding: 10px; text-align: left;">Nome</th>
                <th style="padding: 10px; text-align: center;">Dias</th>
                <th style="padding: 10px; text-align: right;">Horas</th>
                <th style="padding: 10px; text-align: right;">Extras</th>
                <th style="padding: 10px; text-align: right;">Total</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
        <div style="padding: 16px; background: #f1f5f9; border-radius: 0 0 8px 8px; text-align: center;">
          <p style="color: #64748b; font-size: 13px; margin: 0;">
            Relatório gerado automaticamente - Lar Digital - Gestão da Casa
          </p>
        </div>
      </div>
    `;

    return this.send({
      to,
      subject: `[Lar Digital] Fechamento ${meses[mes]}/${ano}`,
      html
    });
  }

  static async sendWhatsAppAlert(reason) {
    return this.sendAlert('whatsapp_disconnect', 'WhatsApp Desconectado!', `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #dc2626; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0;">⚠ WhatsApp Desconectado</h2>
        </div>
        <div style="padding: 20px; background: #fef2f2; border-radius: 0 0 8px 8px;">
          <p><strong>Motivo:</strong> ${reason || 'Desconhecido'}</p>
          <p><strong>Horário:</strong> ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
          <p>O sistema tentará reconectar automaticamente (até 3 tentativas).</p>
          <p>Se o problema persistir, acesse o servidor e reinicie o serviço.</p>
          <hr style="border: none; border-top: 1px solid #fecaca;">
          <p style="color: #991b1b; font-size: 14px;">Lar Digital - Alerta Automático</p>
        </div>
      </div>
    `);
  }
}

module.exports = EmailService;
