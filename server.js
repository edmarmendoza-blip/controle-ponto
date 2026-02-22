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
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
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

// SPA fallback - serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Controle de Ponto rodando na porta ${PORT}`);
  console.log(`Acesse: http://localhost:${PORT}`);

  // Initialize WhatsApp in background (non-blocking)
  whatsappService.initialize().catch(err => {
    console.error('[WhatsApp] Startup error:', err.message);
  });
});
