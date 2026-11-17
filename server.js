/**
 * Serveur principal — CSI Niger v2.0
 * Registre national des Centres de Santé Intégrés
 */

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const logger = require('./src/utils/logger');

// ─── Validation des variables d'environnement obligatoires ───────────────────
const REQUIRED_ENV = ['DATABASE_URL'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  logger.fatal(`Variables d'environnement manquantes: ${missing.join(', ')}`);
  process.exit(1);
}

if (!process.env.JWT_SECRET && !process.env.SECRET) {
  if (process.env.NODE_ENV === 'production') {
    logger.fatal('JWT_SECRET non défini en production — le serveur refuse de démarrer.');
    process.exit(1);
  } else {
    logger.warn('JWT_SECRET non défini — utilisation d\'une clé par défaut INSÉCURISÉE');
  }
}

// ─── Initialisation Express ───────────────────────────────────────────────────
const app = express();

// Configuration trust proxy
const trustProxyEnv = process.env.TRUST_PROXY;
if (trustProxyEnv !== undefined && trustProxyEnv !== '') {
  const tpVal = trustProxyEnv === 'true' ? true : (trustProxyEnv === 'false' ? false : (!isNaN(trustProxyEnv) ? parseInt(trustProxyEnv, 10) : trustProxyEnv));
  app.set('trust proxy', tpVal);
} else {
  app.set('trust proxy', 1);
}

// ─── Mode Développement Total ────────────────────────────────────────────────
if (process.env.MODE_DEV === 'true') {
  logger.warn('⚠️ MODE_DEV ACTIF : Sécurité désactivée pour le développement local.');
}

// ─── Sécurité HTTP ────────────────────────────────────────────────────────────
app.use(helmet(process.env.MODE_DEV === 'true' ? { contentSecurityPolicy: false } : {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://tile.openstreetmap.org", "https://*.tile.openstreetmap.org", "https://unpkg.com"],
      connectSrc: ["'self'"]
    }
  }
}));

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : [];

app.use(cors({
  origin: process.env.MODE_DEV === 'true' ? '*' : (allowedOrigins.length ? allowedOrigins : true),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-token']
}));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // 10 tentatives max par IP
  message: { erreur: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

const verificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { erreur: 'Trop de demandes de code. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300,                 // 300 requêtes/min par IP
  message: { erreur: 'Trop de requêtes. Ralentissez.' }
});

// ─── Parsing ──────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));

// ─── Fichiers statiques ───────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/index.html') {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    }
  }
}));

// ─── Logger des requêtes ──────────────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms,
      ip: req.ip
    }, 'HTTP');
  });
  next();
});

// ─── Routes HTMX (fragments HTML) ────────────────────────────────────────────
app.get('/api/test-htmx', (req, res) => {
  res.send('<h2>✅ HTMX fonctionne !</h2><p>Le fragment a été chargé sans recharger la page.</p>');
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api', apiLimiter);
app.use('/api/login', loginLimiter);
app.use('/api/mot-de-passe-oublie', verificationLimiter);
app.use('/api/me/mot-de-passe', verificationLimiter);
app.use('/api/me/2fa', verificationLimiter);

const authRoutes          = require('./src/routes/auth');
const csiRoutes           = require('./src/routes/csi');
const rapportRoutes       = require('./src/routes/rapports');
const statsRoutes         = require('./src/routes/stats');
const exportRoutes        = require('./src/routes/export');
const catalogueRoutes     = require('./src/routes/catalogue');
const ravitaillementRoutes = require('./src/routes/ravitaillement');
const materniteRoutes     = require('./src/routes/maternite');
const patientRoutes       = require('./src/routes/patients');
const unfpaRoutes         = require('./src/routes/unfpa');
const missionRoutes       = require('./src/routes/missions');
const referentielsRoutes  = require('./src/routes/referentiels');
const adminRoutes         = require('./src/routes/admin');
const alertesRoutes       = require('./src/routes/alertes');
const dashboardRoutes     = require('./src/routes/dashboard');
const logsRoutes          = require('./src/routes/logs');
const apiDocsRoutes       = require('./src/routes/api-docs');

app.use('/api', authRoutes);
app.use('/api/csi', csiRoutes);
app.use('/api', rapportRoutes);
app.use('/api', statsRoutes);
app.use('/api', exportRoutes);
app.use('/api/catalogue', catalogueRoutes);
app.use('/api/ravitaillement', ravitaillementRoutes);
app.use('/api/maternite', materniteRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/unfpa', unfpaRoutes);
app.use('/api/missions', missionRoutes);
app.use('/api/referentiels', referentielsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/alertes', alertesRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/api-docs', apiDocsRoutes);

// ─── Fallback SPA ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Gestion des erreurs globale ──────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error({ err, path: req.path }, 'Erreur non gérée');
  res.status(500).json({ erreur: 'Erreur interne du serveur' });
});

// ─── Démarrage ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || process.env.APP_PORT || 3000;
const server = app.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV || 'development' }, '🏥 CSI Niger démarré');
  logger.info(`  → http://localhost:${PORT}`);
  logger.info(`  → Health: http://localhost:${PORT}/api/health`);
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
const { pool } = require('./src/config/database');

async function shutdown(signal) {
  logger.info({ signal }, 'Signal reçu — arrêt propre en cours...');
  server.close(async () => {
    try {
      await pool.end();
      logger.info('Pool DB fermé. Au revoir.');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Erreur fermeture pool');
      process.exit(1);
    }
  });
  // Forcer l'arrêt après 10s
  setTimeout(() => { logger.error('Timeout arrêt propre'); process.exit(1); }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Exception non gérée — arrêt du serveur');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Promesse rejetée non gérée — arrêt du serveur');
  process.exit(1);
});
