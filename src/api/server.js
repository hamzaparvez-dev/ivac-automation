// src/api/server.js
// Express REST API + Socket.IO for real-time pipeline updates
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { randomUUID } = require('crypto');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const multer = require('multer');
const config = require('../config/config');
const logger = require('../services/logger');
const requireAgentAuth = require('./middleware/auth');
const { authenticateApiKey } = require('./middleware/auth');
const Agent = require('./models/agent');

function timingSafeEqualString(a, b) {
  const as = String(a || '');
  const bs = String(b || '');
  if (!as.length || as.length !== bs.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(as, 'utf8'), Buffer.from(bs, 'utf8'));
  } catch {
    return false;
  }
}

const app = express();
app.set('trust proxy', config.security.trustProxy ? 1 : false);

const server = http.createServer(app);

const corsOrigins = config.security.corsOrigins;
const io = new Server(server, {
  cors: {
    origin: corsOrigins.includes('*') ? '*' : corsOrigins,
    methods: ['GET', 'POST'],
  },
});

if (corsOrigins.includes('*')) {
  app.use(cors());
} else {
  app.use(cors({ origin: corsOrigins, credentials: true }));
}

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  })
);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Fail-fast production checks (configuration errors should crash early).
if (config.app.env === 'production') {
  if (!config.security.corsOrigins || config.security.corsOrigins.includes('*')) {
    throw new Error('CORS_ORIGINS must not include "*" in production');
  }
  if (!config.otp.webhookSecret) {
    throw new Error('OTP_WEBHOOK_SECRET (or OTP_SERVER_API_KEY) must be set in production');
  }
  const captchaSvc = String(config.captcha.service || '2captcha').toLowerCase();
  const useAntiCaptcha = captchaSvc.includes('anticaptcha');
  if (useAntiCaptcha) {
    if (!config.captcha.antiCaptchaKey) {
      throw new Error('ANTICAPTCHA_API_KEY must be set in production when CAPTCHA_SERVICE=anticaptcha');
    }
  } else if (!config.captcha.twoCaptchaKey) {
    throw new Error('TWOCAPTCHA_API_KEY must be set in production (CAPTCHA_SERVICE=2captcha)');
  }
  if (!config.app.jwtSecret || config.app.jwtSecret === 'change-me') {
    throw new Error('JWT_SECRET must be set to a strong random value in production');
  }
}

const apiLimiter = rateLimit({
  windowMs: config.security.rateLimitWindowMs,
  max: config.security.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests' },
});

const webhookLimiter = rateLimit({
  windowMs: config.security.rateLimitWindowMs,
  max: config.security.webhookRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
});

const otpManualLimiter = rateLimit({
  windowMs: config.security.rateLimitWindowMs,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `otp_manual:${String(req.body?.phone || req.ip)}`,
});

app.use('/api', apiLimiter);

const repoRoot = path.join(__dirname, '../..');
for (const sub of ['uploads/bgd', 'uploads/photos', 'uploads/documents', 'logs']) {
  fs.mkdirSync(path.join(repoRoot, sub), { recursive: true });
}
try {
  for (const sub of ['uploads/bgd', 'uploads/photos', 'uploads/documents']) {
    const gitkeep = path.join(repoRoot, sub, '.gitkeep');
    if (!fs.existsSync(gitkeep)) fs.writeFileSync(gitkeep, '');
  }
} catch (e) {
  logger.debug(`Could not write .gitkeep: ${e.message}`);
}

app.use('/dashboard', express.static(path.join(repoRoot, 'dashboard')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = file.mimetype === 'application/pdf' ? 'bgd' : 'photos';
    cb(null, path.join(repoRoot, 'uploads', type));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}_${randomUUID()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!allowed.includes(file.mimetype)) return cb(null, false);
    // Basic extension sanity check; deeper magic-byte sniffing can be added later.
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (file.mimetype === 'application/pdf' && ext !== '.pdf') return cb(null, false);
    if (file.mimetype.startsWith('image/') && !['.jpg', '.jpeg', '.png'].includes(ext)) return cb(null, false);
    return cb(null, true);
  },
});

app.get('/health', (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbOk = dbState === 1;
  const pipelineQueue = require('../services/pipelineQueue');
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    mongo: dbOk ? 'connected' : 'disconnected',
    activeBrowsers: require('../modules/browser').activeCount,
    activeMonitors: require('../modules/slotBooker').monitorCount,
    pipelineQueueWaiting: pipelineQueue.waitingCount(),
    pipelineQueueConcurrency: pipelineQueue.concurrency,
    uptime: process.uptime(),
  });
});

const applicationRoutes = require('./routes/applications')(upload, io);
app.use('/api/applications', requireAgentAuth, applicationRoutes);

const slotRoutes = require('./routes/slots');
app.use('/api/slots', requireAgentAuth, slotRoutes);

const uploadRoutes = require('./routes/uploads');
app.use('/api/uploads', requireAgentAuth, uploadRoutes);

const agentRoutes = require('./routes/agents');
app.use('/api/agents', requireAgentAuth, agentRoutes);

app.post('/api/otp/manual', requireAgentAuth, otpManualLimiter, (req, res) => {
  const { phone, otp } = req.body || {};
  const otpHandler = require('../modules/otpHandler');
  const normalizedPhone = otpHandler._normalizePhone(String(phone || ''));
  const otpStr = String(otp || '').trim();

  if (!normalizedPhone || !otpStr) {
    return res.status(400).json({ success: false, error: 'phone and otp required' });
  }
  if (!/^01[3-9]\d{8}$/.test(normalizedPhone)) {
    return res.status(400).json({ success: false, error: 'Invalid Bangladesh phone number' });
  }
  if (!/^\d{4,8}$/.test(otpStr)) {
    return res.status(400).json({ success: false, error: 'Invalid OTP' });
  }

  const success = otpHandler.submitManualOtp(normalizedPhone, otpStr);
  res.json({
    success,
    message: success ? 'OTP delivered to waiting pipeline' : 'OTP buffered (no waiting pipeline yet)',
  });
});

app.post('/api/otp/webhook', webhookLimiter, (req, res) => {
  const secret = config.otp.webhookSecret;
  const { phone, message, apiKey } = req.body || {};

  if (config.app.env === 'production' && !secret) {
    logger.warn('OTP webhook called but OTP_WEBHOOK_SECRET / OTP_SERVER_API_KEY is not set');
    return res.status(503).json({ success: false, error: 'Webhook not configured' });
  }

  if (secret && !timingSafeEqualString(apiKey, secret)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (!phone || !message) {
    return res.status(400).json({ success: false, error: 'phone and message required' });
  }

  const otpHandler = require('../modules/otpHandler');
  const otp = otpHandler._extractOtp(message);
  if (otp) {
    otpHandler.submitManualOtp(phone, otp);
    logger.info(`OTP webhook received: ${phone}`);
  }
  res.json({ received: true, otp: otp || null });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(repoRoot, 'dashboard/index.html'));
});

io.on('connection', async (socket) => {
  try {
    const token = socket.handshake?.auth?.token;
    const agent = await authenticateApiKey(token);
    if (!agent) {
      socket.emit('error', { message: 'Unauthorized' });
      socket.disconnect(true);
      return;
    }
    socket.data.agent = agent;
    logger.info(`Dashboard connected: ${socket.id} agent=${agent._id}`);

    socket.on('subscribe', async (applicationId) => {
      try {
        const Application = require('./models/application');
        const app = await Application.findOne({ _id: applicationId, agentId: agent._id })
          .select('_id')
          .lean();
        if (!app) return;
        socket.join(`app:${applicationId}`);
        logger.debug(`Socket subscribed to: ${applicationId}`);
      } catch {
        /* ignore */
      }
    });

    socket.on('disconnect', () => {
      logger.debug(`Dashboard disconnected: ${socket.id}`);
    });
  } catch {
    socket.disconnect(true);
  }
});

// Central error handler (keep messages generic in production)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error(err.stack || err.message || String(err));
  if (err.name === 'CastError') {
    return res.status(400).json({ success: false, error: 'Invalid request' });
  }
  const msg = config.app.env === 'production' ? 'Internal server error' : (err.message || 'Internal server error');
  return res.status(500).json({ success: false, error: msg });
});

const slotBooker = require('../modules/slotBooker');
slotBooker.on('slotBooked', ({ sessionId, appointment, application }) => {
  const appId = application?.applicationId;
  if (appId) io.to(`app:${appId}`).emit('slotBooked', { appointment });
});

slotBooker.on('slotsFound', ({ applicationId, available }) => {
  io.to(`app:${applicationId}`).emit('slotsFound', { count: available?.length ?? 0 });
});

const browserManager = require('../modules/browser');

async function shutdown(signal) {
  logger.info(`${signal}: shutting down gracefully...`);
  try {
    const slotBooker = require('../modules/slotBooker');
    const monitors = slotBooker.getMonitorStatus();
    for (const appId of Object.keys(monitors)) {
      slotBooker.stopMonitor(appId);
    }
  } catch (e) {
    logger.warn(`Stop monitors: ${e.message}`);
  }
  try {
    const pipelineQueue = require('../services/pipelineQueue');
    await pipelineQueue.onIdle(10_000);
  } catch (e) {
    logger.warn(`Queue drain: ${e.message}`);
  }
  try {
    await browserManager.closeAll();
  } catch (e) {
    logger.warn(`Browser close: ${e.message}`);
  }
  await new Promise((resolve) => {
    server.close(resolve);
    setTimeout(resolve, 10_000);
  });
  try {
    await mongoose.connection.close();
  } catch (e) {
    logger.warn(`Mongo close: ${e.message}`);
  }
  process.exit(0);
}

mongoose
  .connect(config.db.mongoUri, config.db.mongoOptions)
  .then(() => {
    logger.info('MongoDB connected');

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });
    mongoose.connection.on('error', (err) => {
      logger.error(`MongoDB error: ${err.message}`);
    });

    const host = process.env.HOST || '0.0.0.0';
    const port = config.app.port;
    return Agent.countDocuments()
      .then((count) => {
        if (config.app.env === 'production' && count === 0) {
          throw new Error('No agents exist. Run: node scripts/seedAgent.js "Agent Name"');
        }
        server.listen(port, host, () => {
          logger.info(`IVAC Automation Server listening on http://${host}:${port}`);
          logger.info(`Dashboard: http://localhost:${port}/`);
        });
      });
  })
  .catch((err) => {
    logger.error(`MongoDB connection failed: ${err.message}`);
    process.exit(1);
  });

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, io };
