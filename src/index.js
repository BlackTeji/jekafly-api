require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const { rateLimit } = require('express-rate-limit');

const config = require('./config');
const { errorHandler, notFound } = require('./middleware/error');

// Routes
const authRoutes        = require('./routes/auth');
const applicationRoutes = require('./routes/applications');
const adminRoutes       = require('./routes/admin');
const feeRoutes         = require('./routes/fees');
const documentRoutes    = require('./routes/documents');
const paymentRoutes     = require('./routes/payments');
const insuranceRoutes   = require('./routes/insurance');
const visaRoutes        = require('./routes/visa');

const app = express();

// ─── Security middleware ──────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: config.frontendUrl,
  credentials: true,           // allow cookies
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

// ─── Paystack webhook needs raw body for signature verification ───────────────
app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json' }));

// ─── Standard body parsing ────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─── Logging ─────────────────────────────────────────────────────────────────
if (config.nodeEnv !== 'test') {
  app.use(morgan('combined'));
}

// ─── Global rate limiting ─────────────────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 60 * 1000,     // 1 minute
  max: 100,
  message: { ok: false, error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
}));

// ─── Auth endpoints get stricter rate limiting ────────────────────────────────
app.use('/api/v1/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { ok: false, error: 'Too many login attempts. Please wait 15 minutes.' },
}));
app.use('/api/v1/auth/register', rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { ok: false, error: 'Too many registration attempts.' },
}));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'jekafly-api', timestamp: new Date().toISOString() });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/v1/auth',         authRoutes);
app.use('/api/v1/applications', applicationRoutes);
app.use('/api/v1/admin',        adminRoutes);
app.use('/api/v1/fees',         feeRoutes);
app.use('/api/v1/documents',    documentRoutes);
app.use('/api/v1/payments',     paymentRoutes);
app.use('/api/v1/insurance',    insuranceRoutes);
app.use('/api/v1/visa-requirements', visaRoutes);

// ─── Error handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = config.port;
app.listen(PORT, () => {
  console.log(`\n🚀  Jekafly API running on port ${PORT}`);
  console.log(`   Environment: ${config.nodeEnv}`);
  console.log(`   Health:      http://localhost:${PORT}/health\n`);
});

module.exports = app;
