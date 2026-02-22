const https = require('https');
const { db } = require('../config/database');

const ICS_URL = 'https://calendar.google.com/calendar/ical/pt-br.brazilian%23holiday%40group.v.calendar.google.com/public/basic.ics';

class GoogleCalendarService {
  static fetchICS() {
    return new Promise((resolve, reject) => {
      https.get(ICS_URL, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  static parseICS(icsData) {
    const holidays = [];
    const events = icsData.split('BEGIN:VEVENT');

    for (let i = 1; i < events.length; i++) {
      const event = events[i];
      const endIdx = event.indexOf('END:VEVENT');
      const block = endIdx > -1 ? event.substring(0, endIdx) : event;

      // Extract DTSTART (date only, no time for all-day events)
      const dtMatch = block.match(/DTSTART[^:]*:(\d{4})(\d{2})(\d{2})/);
      if (!dtMatch) continue;

      const date = `${dtMatch[1]}-${dtMatch[2]}-${dtMatch[3]}`;
      const year = parseInt(dtMatch[1]);

      // Extract SUMMARY (holiday name)
      const summaryMatch = block.match(/SUMMARY:(.+)/);
      if (!summaryMatch) continue;

      const name = summaryMatch[1].trim().replace(/\\,/g, ',').replace(/\\n/g, ' ');

      holidays.push({ date, name, year });
    }

    return holidays;
  }

  static async syncHolidays(targetYear) {
    const icsData = await this.fetchICS();
    const holidays = this.parseICS(icsData);

    const currentYear = targetYear || new Date().getFullYear();
    const relevantHolidays = holidays.filter(h => h.year === currentYear);

    let added = 0;
    let updated = 0;

    const findStmt = db.prepare('SELECT id FROM feriados WHERE data = ?');
    const insertStmt = db.prepare('INSERT INTO feriados (data, descricao, tipo, ano) VALUES (?, ?, ?, ?)');
    const updateStmt = db.prepare('UPDATE feriados SET descricao = ? WHERE id = ?');

    for (const holiday of relevantHolidays) {
      const existing = findStmt.get(holiday.date);
      if (existing) {
        updateStmt.run(holiday.name, existing.id);
        updated++;
      } else {
        insertStmt.run(holiday.date, holiday.name, 'nacional', holiday.year);
        added++;
      }
    }

    // Store last sync timestamp
    const upsertConfig = db.prepare('INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = ?');
    const now = new Date().toISOString();
    upsertConfig.run('last_holiday_sync', now, now);

    return { added, updated, total: relevantHolidays.length };
  }

  static getLastSync() {
    const row = db.prepare("SELECT valor FROM configuracoes WHERE chave = 'last_holiday_sync'").get();
    return row ? row.valor : null;
  }
}

module.exports = GoogleCalendarService;
