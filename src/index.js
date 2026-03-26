require('dotenv').config();
const { execSync } = require('child_process');

// ─── Step 1: prisma generate so client matches current schema ─────────────────
try {
  execSync('node node_modules/prisma/build/index.js generate', {
    stdio: 'inherit', env: process.env,
  });
} catch (e) {
  console.error('Prisma generate error (non-fatal):', e.message);
}

// ─── Step 2: Load everything ──────────────────────────────────────────────────
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const { rateLimit } = require('express-rate-limit');

const config = require('./config');
const { errorHandler, notFound } = require('./middleware/error');
const { startCronJobs } = require('./services/cron');

const authRoutes = require('./routes/auth');
const applicationRoutes = require('./routes/applications');
const adminRoutes = require('./routes/admin');
const airportRoute = require('./routes/airports');
const feeRoutes = require('./routes/fees');
const documentRoutes = require('./routes/documents');
const paymentRoutes = require('./routes/payments');
const insuranceRoutes = require('./routes/insurance');
const visaRoutes = require('./routes/visa');
const pricingRoutes = require('./routes/pricing');
const reviewRoutes = require('./routes/reviews');
const affiliateRoutes = require('./routes/affiliates');
const flightRoutes = require('./routes/flights');
const hotelRoutes = require('./routes/hotels');

const app = express();
app.set('trust proxy', 1);

// ── Security ───────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const allowed = [
      config.frontendUrl,
      'http://localhost:5500',
      'http://localhost:5506',
      'http://127.0.0.1:5500',
      'http://127.0.0.1:5506',
    ].filter(Boolean);
    const isVercelPreview = /^https:\/\/jekafly-frontend[a-z0-9-]*\.vercel\.app$/.test(origin);
    if (allowed.includes(origin) || isVercelPreview) return callback(null, origin);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Body parsing ───────────────────────────────────────────────────────────────
// Webhook needs raw body — must come BEFORE express.json()
app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

if (config.nodeEnv !== 'test') app.use(morgan('combined'));

// ── Rate limits ────────────────────────────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 60 * 1000, max: 100,
  message: { ok: false, error: 'Too many requests. Please try again later.' },
  standardHeaders: true, legacyHeaders: false,
}));
app.use('/api/v1/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000, max: 50,
  message: { ok: false, error: 'Too many login attempts. Please wait 15 minutes.' },
  standardHeaders: true, legacyHeaders: false,
}));
app.use('/api/v1/auth/register', rateLimit({
  windowMs: 60 * 60 * 1000, max: 50,
  message: { ok: false, error: 'Too many registration attempts. Please try again later.' },
  standardHeaders: true, legacyHeaders: false,
}));

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/health', (_req, res) =>
  res.json({ ok: true, service: 'jekafly-api', timestamp: new Date().toISOString() })
);

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/applications', applicationRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/airports', airportRoute);
app.use('/api/v1/fees', feeRoutes);
app.use('/api/v1/documents', documentRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/insurance', insuranceRoutes);
app.use('/api/v1/visa-requirements', visaRoutes);
app.use('/api/v1/pricing', pricingRoutes);
app.use('/api/v1/reviews', reviewRoutes);
app.use('/api/v1/affiliates', affiliateRoutes);
app.use('/api/v1/flights', flightRoutes);
app.use('/api/v1/hotels', hotelRoutes);

app.use(notFound);
app.use(errorHandler);

// ─── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  const prisma = require('./utils/prisma');

  // 1. Verify DB connection ─────────────────────────────────────────────────────
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅  Database connected.');
  } catch (err) {
    console.error('❌  Database connection failed:', err.message);
    process.exit(1);
  }

  // 2. Run migrations (opt-in via env flag) ─────────────────────────────────────
  //    Replaces the old `db push --accept-data-loss`.
  //    Set RUN_MIGRATIONS=true in Railway / your deploy config.
  //    Never runs by default so a bad migration can't crash a boot.
  if (process.env.RUN_MIGRATIONS === 'true') {
    try {
      console.log('Running prisma migrate deploy…');
      execSync('node node_modules/prisma/build/index.js migrate deploy', {
        stdio: 'inherit', env: process.env,
      });
      console.log('✅  Migrations applied.');
    } catch (err) {
      console.error('❌  Migration failed — aborting boot:', err.message);
      process.exit(1);
    }
  }

  // 3. Idempotent boot-time patches ─────────────────────────────────────────────
  //    Safe to re-run; fills schema gaps pre-dating migration tracking.
  //    Remove each line once it exists in a proper migration file.
  try {
    await prisma.$executeRawUnsafe(`DO $$ BEGIN ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'CONSULTATION'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE fees          ADD COLUMN IF NOT EXISTS enabled              BOOLEAN   NOT NULL DEFAULT true;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE applications  ADD COLUMN IF NOT EXISTS "passportIssueDate"  TIMESTAMP;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE users          ADD COLUMN IF NOT EXISTS "adminRole"          TEXT;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS "processingFeePercent" INTEGER NOT NULL DEFAULT 5;`);
    await prisma.$executeRawUnsafe(`INSERT INTO pricing_config (id,"consultStandard","consultPriority","consultVip","insuranceBasic","insuranceStandard","insurancePremium","updatedAt") VALUES ('singleton',15000,25000,50000,25000,45000,80000,NOW()) ON CONFLICT (id) DO NOTHING;`);
    await prisma.$executeRawUnsafe(`DO $$ BEGIN CREATE TYPE "AffiliateStatus" AS ENUM ('PENDING','APPROVED','REJECTED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await prisma.$executeRawUnsafe(`DO $$ BEGIN CREATE TYPE "PayoutStatus"    AS ENUM ('PENDING','PROCESSED');           EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    console.log('✅  Boot-time patches applied.');
  } catch (e) {
    console.warn('⚠️   Boot-time patch skipped (non-fatal):', e.message);
  }

  // 4. Seed essential data ───────────────────────────────────────────────────────
  //    Only guarantees admin + service fee exist.
  //    Full seed: npm run db:seed
  try {
    const bcrypt = require('bcryptjs');
    const adminHash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin1234', 12);

    await prisma.user.upsert({
      where: { email: 'admin@jekafly.com' },
      create: {
        id: 'ADMIN001', name: 'Jekafly Admin', email: 'admin@jekafly.com',
        phone: '+234 800 000 0001', passwordHash: adminHash, role: 'ADMIN',
      },
      update: { role: 'ADMIN' },   // ← never overwrite password on every boot
    });

    await prisma.serviceFee.upsert({
      where: { id: 'singleton' }, create: { id: 'singleton', amount: 25000 }, update: {},
    });

    console.log('✅  Essential seed data verified.');
  } catch (err) {
    console.warn('⚠️   Seed warning (non-fatal):', err.message);
  }

  // 5. Start HTTP server ─────────────────────────────────────────────────────────
  const PORT = config.port;
  app.listen(PORT, () => {
    console.log(`\n🚀  Jekafly API running on port ${PORT}`);
    console.log(`   Environment : ${config.nodeEnv}`);
    console.log(`   Health      : http://localhost:${PORT}/health\n`);

    // 6. Start background cron jobs ──────────────────────────────────────────────
    startCronJobs();
  });
}

start();

// ─── ADD TO src/index.js ──────────────────────────────────────────────────────
// 1. Add these requires near the other route requires:
//
//   const airportRoutes      = require('./routes/airports');
//   const flightAdminRoutes  = require('./routes/flights_admin');
//
// 2. Register routes (add after existing app.use lines):
//
//   app.use('/api/v1/airports',        airportRoutes);
//   app.use('/api/v1/admin/flights',   flightAdminRoutes);
//
// 3. Add these lines to your boot-time patches block (step 3 in start()):

/*
    // Airports table
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS airports (
        id         TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
        iata       TEXT        NOT NULL,
        icao       TEXT,
        name       TEXT        NOT NULL,
        city       TEXT        NOT NULL,
        country    TEXT        NOT NULL,
        timezone   TEXT,
        enabled    BOOLEAN     NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP  NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP  NOT NULL DEFAULT NOW(),
        CONSTRAINT airports_pkey PRIMARY KEY (id),
        CONSTRAINT airports_iata_key UNIQUE (iata)
      );
    `);

    // Flights table
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        CREATE TYPE "FlightStatus" AS ENUM ('SCHEDULED','BOARDING','DEPARTED','ARRIVED','CANCELLED','DELAYED');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        CREATE TYPE "BookingStatus" AS ENUM ('PENDING','CONFIRMED','CANCELLED');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS flights (
        id              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "flightNumber"  TEXT NOT NULL,
        airline         TEXT NOT NULL,
        "airlineLogo"   TEXT,
        "originId"      TEXT NOT NULL,
        "destId"        TEXT NOT NULL,
        "departureTime" TEXT NOT NULL,
        "arrivalTime"   TEXT NOT NULL,
        "arrivalOffset" INT  NOT NULL DEFAULT 0,
        terminal        TEXT,
        gate            TEXT,
        aircraft        TEXT,
        "economySeats"  INT  NOT NULL DEFAULT 150,
        "economyPrice"  INT  NOT NULL DEFAULT 0,
        "businessSeats" INT  NOT NULL DEFAULT 30,
        "businessPrice" INT  NOT NULL DEFAULT 0,
        "firstSeats"    INT  NOT NULL DEFAULT 0,
        "firstPrice"    INT  NOT NULL DEFAULT 0,
        enabled         BOOLEAN NOT NULL DEFAULT true,
        "createdAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT flights_pkey PRIMARY KEY (id)
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS flight_instances (
        id              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "flightId"      TEXT NOT NULL,
        date            TIMESTAMP NOT NULL,
        status          "FlightStatus" NOT NULL DEFAULT 'SCHEDULED',
        "economyAvail"  INT NOT NULL,
        "businessAvail" INT NOT NULL,
        "firstAvail"    INT NOT NULL,
        "createdAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT flight_instances_pkey PRIMARY KEY (id),
        CONSTRAINT flight_instances_flightId_date_key UNIQUE ("flightId", date)
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS seat_holds (
        id          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "instanceId" TEXT NOT NULL,
        "cabinClass" TEXT NOT NULL,
        seats       INT NOT NULL DEFAULT 1,
        "sessionId" TEXT NOT NULL,
        "expiresAt" TIMESTAMP NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT seat_holds_pkey PRIMARY KEY (id)
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS flight_bookings (
        id              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        ref             TEXT NOT NULL,
        "userId"        TEXT,
        "instanceId"    TEXT NOT NULL,
        passengers      JSONB NOT NULL DEFAULT '[]',
        "cabinClass"    TEXT NOT NULL,
        seats           INT NOT NULL DEFAULT 1,
        "baseAmount"    INT NOT NULL DEFAULT 0,
        "taxAmount"     INT NOT NULL DEFAULT 0,
        "totalAmount"   INT NOT NULL DEFAULT 0,
        "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
        "paystackRef"   TEXT,
        status          "BookingStatus" NOT NULL DEFAULT 'PENDING',
        "createdAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT flight_bookings_pkey PRIMARY KEY (id),
        CONSTRAINT flight_bookings_ref_key UNIQUE (ref)
      );
    `);

    // Seed default Nigerian airports
    await prisma.$executeRawUnsafe(`
      INSERT INTO airports (id, iata, icao, name, city, country, timezone)
      VALUES
        (gen_random_uuid()::text, 'LOS', 'DNMM', 'Murtala Muhammed International Airport', 'Lagos', 'Nigeria', 'Africa/Lagos'),
        (gen_random_uuid()::text, 'ABV', 'DNAA', 'Nnamdi Azikiwe International Airport', 'Abuja', 'Nigeria', 'Africa/Lagos'),
        (gen_random_uuid()::text, 'KAN', 'DNKN', 'Mallam Aminu Kano International Airport', 'Kano', 'Nigeria', 'Africa/Lagos'),
        (gen_random_uuid()::text, 'PHC', 'DNPO', 'Port Harcourt International Airport', 'Port Harcourt', 'Nigeria', 'Africa/Lagos'),
        (gen_random_uuid()::text, 'LHR', 'EGLL', 'Heathrow Airport', 'London', 'United Kingdom', 'Europe/London'),
        (gen_random_uuid()::text, 'LGW', 'EGKK', 'Gatwick Airport', 'London', 'United Kingdom', 'Europe/London'),
        (gen_random_uuid()::text, 'JFK', 'KJFK', 'John F. Kennedy International Airport', 'New York', 'United States', 'America/New_York'),
        (gen_random_uuid()::text, 'CDG', 'LFPG', 'Charles de Gaulle Airport', 'Paris', 'France', 'Europe/Paris'),
        (gen_random_uuid()::text, 'DXB', 'OMDB', 'Dubai International Airport', 'Dubai', 'UAE', 'Asia/Dubai'),
        (gen_random_uuid()::text, 'AMS', 'EHAM', 'Amsterdam Airport Schiphol', 'Amsterdam', 'Netherlands', 'Europe/Amsterdam'),
        (gen_random_uuid()::text, 'IST', 'LTFM', 'Istanbul Airport', 'Istanbul', 'Turkey', 'Europe/Istanbul'),
        (gen_random_uuid()::text, 'ADD', 'HAAB', 'Bole International Airport', 'Addis Ababa', 'Ethiopia', 'Africa/Addis_Ababa'),
        (gen_random_uuid()::text, 'NBO', 'HKJK', 'Jomo Kenyatta International Airport', 'Nairobi', 'Kenya', 'Africa/Nairobi'),
        (gen_random_uuid()::text, 'JNB', 'FAOR', 'O.R. Tambo International Airport', 'Johannesburg', 'South Africa', 'Africa/Johannesburg'),
        (gen_random_uuid()::text, 'DOH', 'OTHH', 'Hamad International Airport', 'Doha', 'Qatar', 'Asia/Qatar'),
        (gen_random_uuid()::text, 'FRA', 'EDDF', 'Frankfurt Airport', 'Frankfurt', 'Germany', 'Europe/Berlin'),
        (gen_random_uuid()::text, 'BCN', 'LEBL', 'Barcelona–El Prat Airport', 'Barcelona', 'Spain', 'Europe/Madrid'),
        (gen_random_uuid()::text, 'YYZ', 'CYYZ', 'Toronto Pearson International Airport', 'Toronto', 'Canada', 'America/Toronto')
      ON CONFLICT (iata) DO NOTHING;
    `);
*/