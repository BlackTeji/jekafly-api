const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const DEFAULT_FEES = {
  'United Kingdom': 185000, 'United States': 220000, 'Canada': 195000,
  'Australia': 210000, 'France': 160000, 'Germany': 160000,
  'UAE': 95000, 'Japan': 175000, 'China': 180000,
  'South Africa': 120000, 'Italy': 155000, 'Spain': 155000,
  'Netherlands': 155000, 'Portugal': 155000, 'Belgium': 155000,
  'Switzerland': 170000, 'Sweden': 160000, 'Norway': 160000,
  'Denmark': 160000, 'Turkey': 85000, 'India': 75000,
  'Brazil': 130000, 'Saudi Arabia': 90000, 'Ghana': 60000,
  'Kenya': 65000, 'Egypt': 70000,
};

async function main() {
  console.log('🌱 Seeding database...');

  // Admin user — restore or create, always clearing deletedAt
  const adminHash = await bcrypt.hash('admin1234', 12);
  await prisma.user.upsert({
    where: { id: 'ADMIN001' },
    create: {
      id: 'ADMIN001',
      name: 'Jekafly Admin',
      email: 'admin@jekafly.com',
      phone: '+234 800 000 0001',
      passwordHash: adminHash,
      role: 'ADMIN',
      deletedAt: null,
    },
    update: {
      name: 'Jekafly Admin',
      email: 'admin@jekafly.com',
      phone: '+234 800 000 0001',
      passwordHash: adminHash,
      role: 'ADMIN',
      deletedAt: null,
    },
  });
  console.log('✅ Admin user seeded');

  // Service fee
  await prisma.serviceFee.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', amount: 25000 },
    update: {},
  });

  // Default destination fees
  for (const [country, amount] of Object.entries(DEFAULT_FEES)) {
    await prisma.fee.upsert({
      where: { country },
      create: { country, amount, isDefault: true },
      update: {},
    });
  }
  console.log(`✅ ${Object.keys(DEFAULT_FEES).length} destination fees seeded`);

  console.log('\n✅ Seed complete.');
  console.log('   Admin login: admin@jekafly.com / admin1234');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());