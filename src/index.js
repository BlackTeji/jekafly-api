require('dotenv').config();
const { execSync } = require('child_process');

try {
  execSync('node node_modules/prisma/build/index.js generate', {
    stdio: 'inherit', env: process.env,
  });
} catch (e) {
  console.error('Prisma generate error (non-fatal):', e.message);
}

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const { rateLimit } = require('express-rate-limit');

const config = require('./config');
const { errorHandler, notFound } = require('./middleware/error');

const authRoutes = require('./routes/auth');
const applicationRoutes = require('./routes/applications');
const adminRoutes = require('./routes/admin');
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
const bankRoutes = require('./routes/bank');

const app = express();
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        'https://cdnjs.cloudflare.com',
        'https://js.paystack.co',
        'https://fonts.googleapis.com',
        'https://paystack.com',
        'https://app.cal.com',
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        'https://fonts.googleapis.com',
        'https://paystack.com',
      ],
      fontSrc: [
        "'self'",
        'https://fonts.gstatic.com',
      ],
      connectSrc: [
        "'self'",
        'https://api.paystack.co',
        'https://paystack.com',
        'https://api.jekafly.com',
        'https://app.cal.com',
        'https://*.cal.com',
      ],
      imgSrc: ["'self'", 'data:', 'https:'],
      frameSrc: [
        "'self'",
        'blob:',
        'https://checkout.paystack.com',
        'https://app.cal.com',
        'https://*.cal.com',
      ],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      workerSrc: ["'self'", 'blob:', 'https://cdnjs.cloudflare.com'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

const ALLOWED_ORIGINS = [
  config.frontendUrl,
  config.frontendUrl ? config.frontendUrl.replace('https://', 'https://www.') : null,
  'https://jekafly-frontend-verz.vercel.app',
  'http://localhost:5500',
  'http://localhost:5506',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:5506',
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, origin);
    if (config.nodeEnv !== 'production') {
      const isVercelPreview = /^https:\/\/jekafly-frontend-[a-f0-9]{8,}\.vercel\.app$/.test(origin);
      if (isVercelPreview) return callback(null, origin);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

if (config.nodeEnv !== 'test') app.use(morgan('combined'));

app.use('/api/', rateLimit({
  windowMs: 60 * 1000, max: 100,
  message: { ok: false, error: 'Too many requests. Please try again later.' },
  standardHeaders: true, legacyHeaders: false,
}));

app.use('/api/v1/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message: { ok: false, error: 'Too many login attempts. Please wait 15 minutes and try again.' },
  standardHeaders: true, legacyHeaders: false,
}));

app.use('/api/v1/auth/register', rateLimit({
  windowMs: 60 * 60 * 1000, max: 20,
  message: { ok: false, error: 'Too many registration attempts. Please try again later.' },
  standardHeaders: true, legacyHeaders: false,
}));

app.use('/api/v1/auth/forgot-password', rateLimit({
  windowMs: 15 * 60 * 1000, max: 5,
  keyGenerator: (req) => (req.body?.email || '').toLowerCase() || req.ip,
  message: { ok: false, error: 'Too many reset attempts. Please wait before trying again.' },
  standardHeaders: true, legacyHeaders: false,
}));

app.use('/api/v1/auth/reset-password', rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  keyGenerator: (req) => (req.body?.email || '').toLowerCase() || req.ip,
  message: { ok: false, error: 'Too many reset attempts. Please wait before trying again.' },
  standardHeaders: true, legacyHeaders: false,
}));

app.use('/api/v1/affiliates/apply', rateLimit({
  windowMs: 60 * 60 * 1000, max: 3,
  message: { ok: false, error: 'Too many applications submitted. Please try again later.' },
  standardHeaders: true, legacyHeaders: false,
}));

app.use('/api/v1/applications/track', rateLimit({
  windowMs: 60 * 1000, max: 10,
  message: { ok: false, error: 'Too many tracking requests. Please slow down.' },
  standardHeaders: true, legacyHeaders: false,
}));

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'jekafly-api', timestamp: new Date().toISOString() });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/applications', applicationRoutes);
app.use('/api/v1/admin', adminRoutes);
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
app.use('/api/v1/bank', bankRoutes);
app.use('/api/v1/events', require('./routes/events'));
app.use('/api/v1/track', require('./routes/track'));
app.use('/api/v1/holidays', require('./routes/holidays'));
app.use('/api/v1/club', require('./routes/club'));

app.use(notFound);
app.use(errorHandler);

async function start() {
  try {
    const { PrismaClient } = require('@prisma/client');
    const bcrypt = require('bcryptjs');
    const db = new PrismaClient();

    try {
      await db.$executeRawUnsafe(`
        DO $$ BEGIN
          ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'CONSULTATION';
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
      `);
      await db.$executeRawUnsafe(`ALTER TABLE fees ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;`);
      await db.$executeRawUnsafe(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS "passportIssueDate" TIMESTAMP;`);
      await db.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "adminRole" TEXT;`);
      await db.$executeRawUnsafe(`ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS "processingFeePercent" INTEGER NOT NULL DEFAULT 5;`);
      await db.$executeRawUnsafe(`
        INSERT INTO pricing_config (id, "consultStandard", "consultPriority", "consultVip", "insuranceBasic", "insuranceStandard", "clubMembershipFee", "insurancePremium", "updatedAt")
        VALUES ('singleton', 15000, 25000, 50000, 25000, 45000, 80000, 150000, NOW())
        ON CONFLICT (id) DO NOTHING;
      `);
      await db.$executeRawUnsafe(`
        DO $$ BEGIN
          CREATE TYPE "AffiliateStatus" AS ENUM ('PENDING','APPROVED','REJECTED');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
      `);
      await db.$executeRawUnsafe(`
        DO $$ BEGIN
          CREATE TYPE "PayoutStatus" AS ENUM ('PENDING','PROCESSED');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
      `);
      await db.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT NOT NULL,
          "actorId" TEXT NOT NULL,
          action TEXT NOT NULL,
          "targetId" TEXT,
          meta JSONB,
          "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT audit_log_pkey PRIMARY KEY (id)
        );
        CREATE INDEX IF NOT EXISTS "audit_log_actorId_idx" ON audit_log("actorId");
        CREATE INDEX IF NOT EXISTS "audit_log_action_idx" ON audit_log(action);
        CREATE INDEX IF NOT EXISTS "audit_log_createdAt_idx" ON audit_log("createdAt");
      `);
      console.log('Schema patches applied.');
    } catch (e) {
      console.error('Schema patch (non-fatal):', e.message);
    }

    console.log('Running database migrations...');
    try {
      execSync('node node_modules/prisma/build/index.js migrate deploy', {
        stdio: 'inherit', env: process.env,
      });
      console.log('Migrations applied.');
    } catch (e) {
      console.error('Migration error (non-fatal):', e.message);
    }

    const adminHash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin1234', 12);
    const existingAdmin = await db.user.findUnique({ where: { id: 'ADMIN001' } });
    if (existingAdmin) {
      await db.user.update({
        where: { id: 'ADMIN001' },
        data: { role: 'ADMIN', adminRole: 'super' },
      });
    } else {
      await db.user.create({
        data: {
          id: 'ADMIN001', name: 'Jekafly Admin', email: 'admin@jekafly.com',
          phone: '+234 800 000 0001', passwordHash: adminHash, role: 'ADMIN', adminRole: 'super',
        },
      });
    }

    await db.serviceFee.upsert({
      where: { id: 'singleton' }, create: { id: 'singleton', amount: 25000 }, update: {},
    });

    const DEFAULT_FEES = {
      'United Kingdom': 185000, 'United States': 220000, 'Canada': 195000, 'Australia': 210000,
      'France': 160000, 'Germany': 160000, 'UAE': 95000, 'Japan': 175000, 'China': 180000,
      'South Africa': 120000, 'Italy': 155000, 'Spain': 155000, 'Netherlands': 155000,
      'Portugal': 155000, 'Belgium': 155000, 'Switzerland': 170000, 'Sweden': 160000,
      'Norway': 160000, 'Denmark': 160000, 'Turkey': 85000, 'India': 75000,
      'Brazil': 130000, 'Saudi Arabia': 90000, 'Ghana': 60000, 'Kenya': 65000, 'Egypt': 70000,
    };
    for (const [country, amount] of Object.entries(DEFAULT_FEES)) {
      await db.fee.upsert({
        where: { country }, create: { country, amount, isDefault: true }, update: {},
      });
    }

    // ─── Holiday & Club seed ─────────────────────────────────────────────────────

    const CLUB_PERKS = [
      { title: 'Early Access to Travel Deals', description: 'Be first to know about flash sales and exclusive travel deals before they go public.', icon: 'tag', sortOrder: 1 },
      { title: 'Vacation Package Discounts', description: 'Members receive exclusive discounts on all Jekafly holiday packages.', icon: 'percent', sortOrder: 2 },
      { title: 'Visa Assistance & Document Support', description: 'Priority visa consultation and document review for your travel plans.', icon: 'file-check', sortOrder: 3 },
      { title: 'Personalised Itinerary Planning', description: 'Tailored travel itineraries crafted to your preferences and schedule.', icon: 'map', sortOrder: 4 },
      { title: 'Airport Lounge Access', description: 'Complimentary access to partner airport lounges across Nigeria and select international airports.', icon: 'building', sortOrder: 5 },
      { title: 'Lounge Guest Passes', description: 'Bring a guest into the lounge — members receive guest passes each membership year.', icon: 'users', sortOrder: 6 },
      { title: '24/7 Concierge Service', description: 'Round-the-clock personal concierge for bookings, reservations, and travel support.', icon: 'headphones', sortOrder: 7 },
      { title: 'Entertainment Discounts', description: 'Exclusive discounts on events, shows, experiences, and backstage access through Jekafly partners.', icon: 'ticket', sortOrder: 8 },
    ];

    await db.clubPerk.createMany({ data: CLUB_PERKS, skipDuplicates: true });

    const HOLIDAYS = [
      // ── Southwest ──────────────────────────────────────────────────────────────
      {
        region: 'Southwest', state: 'Lagos State', packageName: 'The Eko Experience',
        tagline: 'Where Energy Meets Luxury', tier: 'SIGNATURE',
        durationDays: 2, durationNights: 1, priceSignature: 350000,
        experienceType: 'Urban Lifestyle, Entertainment, Beaches, Nightlife',
        attractions: ['Boat Cruise Experience', 'Beach Day Out', 'Art Gallery Visit', 'Blue Line Rail Experience', 'Nightlife Experience in Lekki & Victoria Island', 'Restaurant Fine Dining'],
        inclusions: ['Daily Breakfast', 'Hotel Accommodation', 'Intercity Transfer and local movement', 'Curated Destination Guide', 'Access to listed Attractions', 'Branded Travel Pack'],
      },
      {
        region: 'Southwest', state: 'Ogun State', packageName: 'Gateway Trails',
        tagline: 'Discover Heritage Beyond the Horizon', tier: 'EXPLORER',
        durationDays: 2, durationNights: 1, priceExplorer: 280000,
        experienceType: 'Heritage, Culture, Nature, Adventure',
        attractions: ['Rock Climbing Adventure', 'Adire Market Experience', 'OOPL Wildlife Park', 'Cultural City Tours'],
        inclusions: ['Daily Breakfast', 'Hotel Accommodation', 'Intercity Transfer and local movement', 'Curated Destination Guide', 'Access to listed Attractions', 'Branded Travel Pack'],
      },
      {
        region: 'Southwest', state: 'Oyo State', packageName: 'The Alaafin Legacy',
        tagline: 'Walk Through the Kingdom of Legends', tier: 'EXPLORER',
        durationDays: 2, durationNights: 2, priceExplorer: 280000,
        experienceType: 'Royal Heritage, History, Food & Culture',
        attractions: ['Ibadan City Tour', 'Agodi Gardens', 'Heritage Sites', 'Local Cuisine Experience'],
        inclusions: ['Daily Breakfast', 'Hotel Accommodation', 'Intercity Transfer and local movement', 'Curated Destination Guide', 'Access to listed Attractions', 'Branded Travel Pack'],
      },
      {
        region: 'Southwest', state: 'Ondo State', packageName: 'Sunrise Coast Escape',
        tagline: 'Where Nature Meets Serenity', tier: 'EXECUTIVE',
        durationDays: 3, durationNights: 2, priceExecutive: 300000,
        experienceType: 'Nature, Adventure, Wellness',
        attractions: ['Idanre Hills', 'Coastal Exploration', 'Eco-Tourism Trails', 'Nature Retreat'],
        inclusions: ['Daily Breakfast', 'Hotel Accommodation', 'Intercity Transfer and local movement', 'Curated Destination Guide', 'Access to listed Attractions', 'Branded Travel Pack'],
      },
      {
        region: 'Southwest', state: 'Osun State', packageName: 'Sacred Osun Journey',
        tagline: 'Experience the Spirit of Heritage', tier: 'EXPLORER',
        durationDays: 2, durationNights: 1, priceExplorer: 280000,
        experienceType: 'Spiritual Tourism, Heritage, Culture',
        attractions: ['Osun Sacred Grove', 'Ile-Ife Heritage Tour', 'Cultural Village Experience'],
        inclusions: ['Daily Breakfast', 'Hotel Accommodation', 'Intercity Transfer and local movement', 'Curated Destination Guide', 'Access to listed Attractions', 'Branded Travel Pack'],
      },
      {
        region: 'Southwest', state: 'Ekiti State', packageName: 'The Hidden Gem Escape',
        tagline: "Discover Nigeria's Best-Kept Secret", tier: 'EXECUTIVE',
        durationDays: 3, durationNights: 2, priceExecutive: 300000,
        experienceType: 'Eco-Tourism, Wellness, Adventure',
        attractions: ['Ikogosi Warm Springs', 'Arinta Waterfalls', 'Hiking & Nature Exploration'],
        inclusions: ['Daily Breakfast', 'Hotel Accommodation', 'Intercity Transfer and local movement', 'Curated Destination Guide', 'Access to listed Attractions', 'Branded Travel Pack'],
      },
      // ── South-South ────────────────────────────────────────────────────────────
      {
        region: 'South-South', state: 'Akwa Ibom State', packageName: 'The Ibom Escape',
        tagline: 'Where Hospitality Meets Paradise', tier: 'SIGNATURE',
        durationDays: 3, durationNights: 2, priceSignature: 320000,
        experienceType: 'Coastal Luxury',
        attractions: ['Ibeno Beach', 'Ibom Plaza', 'Raffia City Tour'],
        inclusions: ['Hotel Accommodation', 'Daily Breakfast', 'Transfers', 'Tour Guide', 'Attraction Access'],
      },
      {
        region: 'South-South', state: 'Cross River State', packageName: 'The Calabar Discovery',
        tagline: "Experience Nigeria's Tourism Capital", tier: 'SIGNATURE',
        durationDays: 4, durationNights: 3, priceSignature: 380000,
        experienceType: 'Culture & Nature',
        attractions: ['Obudu Mountain Resort', 'Tinapa', 'Marina Resort'],
        inclusions: ['Hotel Accommodation', 'Daily Breakfast', 'Transfers', 'Tour Guide', 'Attraction Access'],
      },
      {
        region: 'South-South', state: 'Rivers State', packageName: 'Garden City Prestige',
        tagline: 'Business Meets Lifestyle', tier: 'SIGNATURE',
        durationDays: 3, durationNights: 2, priceSignature: 350000,
        experienceType: 'Urban Lifestyle',
        attractions: ['Port Harcourt City Tour', 'Pleasure Park', 'Nightlife'],
        inclusions: ['Hotel Accommodation', 'Daily Breakfast', 'Transfers', 'Tour Guide'],
      },
      {
        region: 'South-South', state: 'Bayelsa State', packageName: 'Creeks & Culture Experience',
        tagline: 'Discover the Heart of the Delta', tier: 'EXPLORER',
        durationDays: 3, durationNights: 2, priceExplorer: 280000,
        experienceType: 'Eco & Cultural Tourism',
        attractions: ['Oxbow Lake', 'Creek Excursions'],
        inclusions: ['Hotel Accommodation', 'Boat Transfers', 'Tour Guide'],
      },
      {
        region: 'South-South', state: 'Delta State', packageName: 'Delta Heritage Trail',
        tagline: 'Where Tradition Meets Modernity', tier: 'EXPLORER',
        durationDays: 3, durationNights: 2, priceExplorer: 300000,
        experienceType: 'Heritage & Lifestyle',
        attractions: ['Nana Living History Museum', 'Asaba City Tour'],
        inclusions: ['Hotel Accommodation', 'Transfers', 'Tour Guide'],
      },
      {
        region: 'South-South', state: 'Edo State', packageName: 'Benin Kingdom Legacy',
        tagline: 'Walk Through a Timeless Empire', tier: 'SIGNATURE',
        durationDays: 3, durationNights: 2, priceSignature: 330000,
        experienceType: 'Royal Heritage',
        attractions: ['Benin Moat', 'National Museum', 'Palace District'],
        inclusions: ['Hotel Accommodation', 'Daily Breakfast', 'Transfers', 'Tour Guide'],
      },
      // ── Southeast ──────────────────────────────────────────────────────────────
      {
        region: 'Southeast', state: 'Anambra State', packageName: 'The Light of the Nation Experience',
        tagline: 'Discover Enterprise & Heritage', tier: 'SIGNATURE',
        durationDays: 3, durationNights: 2, priceSignature: 300000,
        experienceType: 'Culture & Commerce',
        attractions: ['Ogbunike Cave', 'Onitsha Experience'],
        inclusions: ['Hotel Accommodation', 'Daily Breakfast', 'Transfers'],
      },
      {
        region: 'Southeast', state: 'Enugu State', packageName: 'Coal City Escape',
        tagline: 'Nature, History & Serenity', tier: 'SIGNATURE',
        durationDays: 3, durationNights: 2, priceSignature: 320000,
        experienceType: 'Nature & Heritage',
        attractions: ['Ngwo Pine Forest', 'Awhum Waterfall'],
        inclusions: ['Hotel Accommodation', 'Tour Guide', 'Transfers'],
      },
      {
        region: 'Southeast', state: 'Imo State', packageName: 'Eastern Heartland Retreat',
        tagline: 'Relax. Explore. Connect.', tier: 'EXPLORER',
        durationDays: 3, durationNights: 2, priceExplorer: 280000,
        experienceType: 'Leisure Tourism',
        attractions: ['Oguta Lake', 'Cultural Villages'],
        inclusions: ['Hotel Accommodation', 'Transfers'],
      },
      {
        region: 'Southeast', state: 'Abia State', packageName: 'Aba Enterprise Journey',
        tagline: 'Innovation Meets Culture', tier: 'EXPLORER',
        durationDays: 2, durationNights: 1, priceExplorer: 250000,
        experienceType: 'Commerce Tourism',
        attractions: ['Ariaria Market', 'Cultural Sites'],
        inclusions: ['Hotel Accommodation', 'Tour Guide'],
      },
      {
        region: 'Southeast', state: 'Ebonyi State', packageName: 'Salt of the Nation Adventure',
        tagline: 'Discover Hidden Wonders', tier: 'EXPLORER',
        durationDays: 3, durationNights: 2, priceExplorer: 270000,
        experienceType: 'Nature & Agriculture',
        attractions: ['Salt Lakes', 'Waterfalls'],
        inclusions: ['Hotel Accommodation', 'Transfers', 'Tour Guide'],
      },
      // ── North-Central ──────────────────────────────────────────────────────────
      {
        region: 'North-Central', state: 'FCT Abuja', packageName: 'Capital Explorer',
        tagline: "Discover Nigeria's Seat of Power", tier: 'SIGNATURE',
        durationDays: 3, durationNights: 2, priceSignature: 350000,
        experienceType: 'Urban Tourism',
        attractions: ['Zuma Rock', 'Millennium Park', 'City Tour'],
        inclusions: ['Hotel Accommodation', 'Transfers', 'Tour Guide'],
      },
      {
        region: 'North-Central', state: 'Niger State', packageName: 'The Confluence Adventure',
        tagline: 'Nature Beyond Imagination', tier: 'SIGNATURE',
        durationDays: 4, durationNights: 3, priceSignature: 400000,
        experienceType: 'Adventure Tourism',
        attractions: ['Gurara Falls', 'Kainji Lake'],
        inclusions: ['Hotel Accommodation', 'Transfers'],
      },
      {
        region: 'North-Central', state: 'Kwara State', packageName: 'Harmony Escape',
        tagline: 'Where Cultures Meet', tier: 'EXPLORER',
        durationDays: 3, durationNights: 2, priceExplorer: 280000,
        experienceType: 'Heritage Tourism',
        attractions: ['Esie Museum', 'Owu Falls'],
        inclusions: ['Hotel Accommodation', 'Tour Guide'],
      },
      {
        region: 'North-Central', state: 'Kogi State', packageName: 'The Confluence Experience',
        tagline: 'Where Rivers Meet, Stories Begin', tier: 'EXPLORER',
        durationDays: 3, durationNights: 2, priceExplorer: 300000,
        experienceType: 'Nature & Heritage',
        attractions: ['River Niger-Benue Confluence'],
        inclusions: ['Hotel Accommodation', 'Transfers'],
      },
      {
        region: 'North-Central', state: 'Benue State', packageName: 'Food Basket Discovery',
        tagline: 'Taste the Heart of Nigeria', tier: 'EXPLORER',
        durationDays: 3, durationNights: 2, priceExplorer: 280000,
        experienceType: 'Agro Tourism',
        attractions: ['Makurdi Riverfront', 'Cultural Experiences'],
        inclusions: ['Hotel Accommodation', 'Tour Guide'],
      },
      {
        region: 'North-Central', state: 'Plateau State', packageName: 'Jos Highland Escape',
        tagline: 'Cool Weather, Endless Adventure', tier: 'SIGNATURE',
        durationDays: 4, durationNights: 3, priceSignature: 420000,
        experienceType: 'Mountain Tourism',
        attractions: ['Shere Hills', 'Wildlife Park'],
        inclusions: ['Hotel Accommodation', 'Transfers', 'Tour Guide'],
      },
      {
        region: 'North-Central', state: 'Nasarawa State', packageName: 'Hidden Treasures of Nasarawa',
        tagline: "Nigeria's Best Kept Secret", tier: 'EXPLORER',
        durationDays: 3, durationNights: 2, priceExplorer: 270000,
        experienceType: 'Eco Tourism',
        attractions: ['Farin Ruwa Falls'],
        inclusions: ['Hotel Accommodation', 'Tour Guide'],
      },
      // ── Northwest ──────────────────────────────────────────────────────────────
      {
        region: 'Northwest', state: 'Kano State', packageName: 'Kano Emirate Experience',
        tagline: 'Journey Through Centuries', tier: 'SIGNATURE',
        durationDays: 4, durationNights: 3, priceSignature: 450000,
        experienceType: 'Heritage Tourism',
        attractions: ['Ancient City Walls', "Emir's Palace"],
        inclusions: ['Hotel Accommodation', 'Tour Guide'],
      },
      {
        region: 'Northwest', state: 'Kaduna State', packageName: 'Northern Gateway Escape',
        tagline: 'Adventure Meets History', tier: 'SIGNATURE',
        durationDays: 3, durationNights: 2, priceSignature: 350000,
        experienceType: 'Heritage & Nature',
        attractions: ['Kajuru Castle', 'Matsirga Falls'],
        inclusions: ['Hotel Accommodation', 'Transfers'],
      },
      {
        region: 'Northwest', state: 'Katsina State', packageName: 'Land of Legends Trail',
        tagline: 'Experience Timeless Traditions', tier: 'EXPLORER',
        durationDays: 3, durationNights: 2, priceExplorer: 300000,
        experienceType: 'Cultural Tourism',
        attractions: ['Gobarau Minaret'],
        inclusions: ['Hotel Accommodation', 'Tour Guide'],
      },
      {
        region: 'Northwest', state: 'Jigawa State', packageName: 'Golden Dunes Journey',
        tagline: 'Beyond the Ordinary', tier: 'EXPLORER',
        durationDays: 3, durationNights: 2, priceExplorer: 280000,
        experienceType: 'Desert Tourism',
        attractions: ['Wetlands & Cultural Sites'],
        inclusions: ['Hotel Accommodation', 'Transfers'],
      },
      {
        region: 'Northwest', state: 'Sokoto State', packageName: 'Caliphate Heritage Tour',
        tagline: 'Discover the Legacy of Leaders', tier: 'SIGNATURE',
        durationDays: 4, durationNights: 3, priceSignature: 420000,
        experienceType: 'Historical Tourism',
        attractions: ["Sultan's Palace", 'Museum'],
        inclusions: ['Hotel Accommodation', 'Tour Guide'],
      },
      {
        region: 'Northwest', state: 'Kebbi State', packageName: 'Argungu Adventure',
        tagline: 'Tradition on the Water', tier: 'EXPLORER',
        durationDays: 3, durationNights: 2, priceExplorer: 300000,
        experienceType: 'Festival Tourism',
        attractions: ['Argungu Festival Grounds'],
        inclusions: ['Hotel Accommodation', 'Transfers'],
      },
      {
        region: 'Northwest', state: 'Zamfara State', packageName: 'Northern Frontier Experience',
        tagline: 'Discover Untold Stories', tier: 'EXPLORER',
        durationDays: 3, durationNights: 2, priceExplorer: 280000,
        experienceType: 'Cultural Tourism',
        attractions: ['Heritage Communities'],
        inclusions: ['Hotel Accommodation', 'Tour Guide'],
      },
      // ── Northeast ──────────────────────────────────────────────────────────────
      {
        region: 'Northeast', state: 'Adamawa State', packageName: 'Highlands of Adamawa',
        tagline: 'Adventure Above the Clouds', tier: 'SIGNATURE',
        durationDays: 4, durationNights: 3, priceSignature: 450000,
        experienceType: 'Mountain Tourism',
        attractions: ['Mambilla Plateau Region'],
        inclusions: ['Hotel Accommodation', 'Tour Guide', 'Transfers'],
      },
      {
        region: 'Northeast', state: 'Taraba State', packageName: "Nature's Masterpiece Escape",
        tagline: "Explore Nigeria's Green Frontier", tier: 'SIGNATURE',
        durationDays: 4, durationNights: 3, priceSignature: 480000,
        experienceType: 'Eco Tourism',
        attractions: ['Gashaka Gumti National Park'],
        inclusions: ['Hotel Accommodation', 'Tour Guide'],
      },
      {
        region: 'Northeast', state: 'Borno State', packageName: 'Lake Chad Heritage Journey',
        tagline: 'Discover Ancient Trade Routes', tier: 'EXPLORER',
        durationDays: 3, durationNights: 2, priceExplorer: 320000,
        experienceType: 'Historical Tourism',
        attractions: ['Cultural Heritage Experiences'],
        inclusions: ['Hotel Accommodation', 'Tour Guide'],
      },
      {
        region: 'Northeast', state: 'Yobe State', packageName: 'Desert Discovery Trail',
        tagline: 'Experience Northern Horizons', tier: 'EXPLORER',
        durationDays: 3, durationNights: 2, priceExplorer: 300000,
        experienceType: 'Desert Tourism',
        attractions: ['Dune Landscapes'],
        inclusions: ['Hotel Accommodation', 'Transfers'],
      },
      {
        region: 'Northeast', state: 'Bauchi State', packageName: 'Yankari Wildlife Safari',
        tagline: "Africa's Wild Side Awaits", tier: 'EXECUTIVE',
        durationDays: 5, durationNights: 4, priceExecutive: 650000,
        experienceType: 'Safari Tourism',
        attractions: ['Yankari Game Reserve'],
        inclusions: ['Resort Accommodation', 'Safari Guide', 'Transfers'],
      },
      {
        region: 'Northeast', state: 'Gombe State', packageName: 'Jewel of the Savannah',
        tagline: 'Discover Untamed Beauty', tier: 'EXPLORER',
        durationDays: 3, durationNights: 2, priceExplorer: 290000,
        experienceType: 'Eco Tourism',
        attractions: ['Savannah Landscapes'],
        inclusions: ['Hotel Accommodation', 'Tour Guide'],
      },
    ];

    for (const h of HOLIDAYS) {
      await db.holiday.upsert({
        where: { state_packageName: { state: h.state, packageName: h.packageName } },
        create: h,
        update: {
          tagline: h.tagline,
          tier: h.tier,
          durationDays: h.durationDays,
          durationNights: h.durationNights,
          priceExplorer: h.priceExplorer ?? null,
          priceSignature: h.priceSignature ?? null,
          priceExecutive: h.priceExecutive ?? null,
          experienceType: h.experienceType,
          attractions: h.attractions,
          inclusions: h.inclusions,
        },
      });
    }

    console.log('Holiday & club seed complete.');

    await db.$disconnect();
    console.log('Database seeded.');
  } catch (err) {
    console.error('DB setup error:', err.message);
    console.error('DB setup stack:', err.stack);
  }

  const PORT = config.port;
  app.listen(PORT, () => {
    console.log(`\n🚀  Jekafly API running on port ${PORT}`);
    console.log(`   Environment: ${config.nodeEnv}`);
    console.log(`   Health:      http://localhost:${PORT}/health\n`);
  });

  const { sendPendingSurveys } = require('./controllers/reviews');
  sendPendingSurveys().catch(err => console.error('Survey scheduler error:', err));
  setInterval(() => {
    sendPendingSurveys().catch(err => console.error('Survey scheduler error:', err));
  }, 60 * 60 * 1000);
}

start();