process.env.TZ = 'America/Sao_Paulo';
require('dotenv').config();

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const { initializeDatabase } = require('./src/config/database');
const { apiLimiter } = require('./src/middleware/rateLimiter');
const whatsappService = require('./src/services/whatsapp');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (Nginx reverse proxy)
app.set('trust proxy', 1);

// Initialize database
initializeDatabase();

// Security & middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net", "https://unpkg.com", "https://cdn.tailwindcss.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://unpkg.com", "https://cdn.tailwindcss.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.tile.openstreetmap.org"],
      connectSrc: ["'self'", "https://calendar.google.com"],
      upgradeInsecureRequests: null
    }
  }
}));
app.use(cors());
app.use(compression());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiter for API
app.use('/api', apiLimiter);

// API Routes
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/funcionarios', require('./src/routes/funcionarios'));
app.use('/api/registros', require('./src/routes/registros'));
app.use('/api/relatorios', require('./src/routes/relatorios'));
app.use('/api/export', require('./src/routes/export'));
app.use('/api/feriados', require('./src/routes/feriados'));
app.use('/api/whatsapp', require('./src/routes/whatsapp'));
app.use('/api/dashboard/presenca', require('./src/routes/dashboardPresenca'));
app.use('/api/insights', require('./src/routes/insights'));
app.use('/api/holerites', require('./src/routes/holerites'));
app.use('/api/cargos', require('./src/routes/cargos'));
app.use('/api/entregas', require('./src/routes/entregas'));
app.use('/api/users', require('./src/routes/users'));
app.use('/api/tarefas', require('./src/routes/tarefas'));
app.use('/api/audit-log', require('./src/routes/auditLog'));
app.use('/api/veiculos', require('./src/routes/veiculos'));
app.use('/api/documentos', require('./src/routes/documentos'));
app.use('/api/estoque', require('./src/routes/estoque'));

// Version endpoint
app.get('/api/version', (req, res) => {
  try {
    const versionData = require('./version.json');
    res.json(versionData);
  } catch (err) {
    res.json({ version: '2.0.0', env: 'sandbox' });
  }
});

// Health check endpoint (public, no auth)
app.get('/api/health', (req, res) => {
  let dbStatus = 'connected';
  try {
    const { db } = require('./src/config/database');
    db.prepare('SELECT 1').get();
  } catch (e) {
    dbStatus = 'error: ' + e.message;
  }

  let whatsappStatus = 'disconnected';
  let lastWhatsappMessage = null;
  try {
    const ws = require('./src/services/whatsapp');
    whatsappStatus = ws.status || 'disconnected';
    const { db } = require('./src/config/database');
    const lastMsg = db.prepare('SELECT created_at FROM whatsapp_mensagens ORDER BY id DESC LIMIT 1').get();
    if (lastMsg) lastWhatsappMessage = lastMsg.created_at;
  } catch (e) {}

  let versionData = { version: 'unknown', env: 'unknown' };
  try { versionData = require('./version.json'); } catch (e) {}

  res.json({
    status: dbStatus === 'connected' ? 'healthy' : 'degraded',
    version: versionData.version,
    env: versionData.env,
    timestamp: new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }),
    services: {
      database: dbStatus,
      whatsapp: whatsappStatus,
      last_whatsapp_message: lastWhatsappMessage,
      uptime: Math.floor(process.uptime()) + 's'
    }
  });
});

// Root redirect to dashboard
app.get('/', (req, res) => {
  res.redirect('/dashboard.html');
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// Export app for testing (supertest)
module.exports = app;

// Start server when run directly or via PM2
if (require.main === module || process.env.NODE_ENV === 'production' || process.env.pm_id !== undefined) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Lar Digital rodando na porta ${PORT}`);
    console.log(`Acesse: http://localhost:${PORT}`);

    // Initialize WhatsApp in background (non-blocking)
    whatsappService.initialize().catch(err => {
      console.error('[WhatsApp] Startup error:', err.message);
    });

    // Auto-sync holidays on startup and every 30 days
    const GoogleCalendarService = require('./src/services/googleCalendar');
    GoogleCalendarService.syncHolidays().then(result => {
      console.log(`[Holiday Sync] ${result.added} added, ${result.updated} updated`);
    }).catch(err => {
      console.error('[Holiday Sync] Startup error:', err.message);
    });

    // Re-sync every 7 days (safe for 32-bit signed integer max ~24.8 days)
    setInterval(() => {
      GoogleCalendarService.syncHolidays().then(result => {
        console.log(`[Holiday Sync] Periodic: ${result.added} added, ${result.updated} updated`);
      }).catch(err => {
        console.error('[Holiday Sync] Periodic error:', err.message);
      });
    }, 7 * 24 * 60 * 60 * 1000); // 7 days

    // Daily insights generation at 00:05
    function scheduleMidnightInsights() {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setDate(midnight.getDate() + 1);
      midnight.setHours(0, 5, 0, 0);
      const msUntilMidnight = midnight - now;

      setTimeout(() => {
        const InsightsIA = require('./src/services/insightsIA');
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const dateStr = yesterday.toISOString().split('T')[0];
        InsightsIA.generateDailyInsights(dateStr).then(r => {
          console.log(`[Insights IA] Daily: generated for ${dateStr}`);
        }).catch(err => {
          console.error('[Insights IA] Daily error:', err.message);
        });
        scheduleMidnightInsights();
      }, msUntilMidnight);
    }
    scheduleMidnightInsights();

    // Initialize email schedulers (vacation alerts, monthly closing, IMAP sync)
    const Schedulers = require('./src/services/schedulers');
    Schedulers.init();
  });

  // Graceful shutdown: destroy WhatsApp client (kill Chrome) before PM2 restart
  const gracefulShutdown = async (signal) => {
    console.log(`[Server] ${signal} received, shutting down gracefully...`);
    try {
      if (whatsappService.client) {
        console.log('[Server] Destroying WhatsApp client...');
        whatsappService.client.removeAllListeners();
        await Promise.race([
          whatsappService.client.destroy(),
          new Promise(resolve => setTimeout(resolve, 5000)) // 5s timeout
        ]);
        console.log('[Server] WhatsApp client destroyed.');
      }
    } catch (err) {
      console.error('[Server] Error destroying WhatsApp:', err.message);
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}
