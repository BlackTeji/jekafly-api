require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const { rateLimit } = require('express-rate-limit');
const { execSync } = require('child_process');

const config = require('./config');
const { errorHandler, notFound } = require('./middleware/error');
const prisma = require('./utils/prisma');

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

// ─── Run DB migration + seed on startup ──────────────────────────────────────
async function setupDatabase() {
  try {
    console.log('Running database migrations...');
    execSync('node node_modules/prisma/build/index.js migrate deploy', {
      stdio: 'inherit',
      env: process.env,
    });
    console.log('Migrations complete.');

    // Seed default data
    const { PrismaClient } = require('@prisma/client');
    const bcrypt = require('bcryptjs');
    const db = new PrismaClient();

    const adminHash = await bcrypt.hash('admin1234', 12);
    await db.user.upsert({
      where: { email: 'admin@jekafly.com' },
      create: { id: 'ADMIN001', name: 'Jekafly Admin', email: 'admin@jekafly.com',
                phone: '+234 800 000 0001', passwordHash: adminHash, role: 'ADMIN' },
      update: {},
    });

    await db.serviceFee.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', amount: 25000 },
      update: {},
    });

    const DEFAULT_FEES = {
      'United Kingdom':185000,'United States':220000,'Canada':195000,'Australia':210000,
      'France':160000,'Germany':160000,'UAE':95000,'Japan':175000,'China':180000,
      'South Africa':120000,'Italy':155000,'Spain':155000,'Netherlands':155000,
      'Portugal':155000,'Belgium':155000,'Switzerland':170000,'Sweden':160000,
      'Norway':160000,'Denmark':160000,'Turkey':85000,'India':75000,
      'Brazil':130000,'Saudi Arabia':90000,'Ghana':60000,'Kenya':65000,'Egypt':70000,
    };
    for (const [country, amount] of Object.entries(DEFAULT_FEES)) {
      await db.fee.upsert({
        where: { country },
        create: { country, amount, isDefault: true },
        update: {},
      });
    }
    await db.$disconnect();
    console.log('Database seeded.');
  } catch (err) {
    console.error('DB setup error:', err.message);
    // Don't crash — migrations may already be applied
  }
}

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

setupDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀  Jekafly API running on port ${PORT}`);
    console.log(`   Environment: ${config.nodeEnv}`);
    console.log(`   Health:      http://localhost:${PORT}/health\n`);
  });
});

module.exports = app;