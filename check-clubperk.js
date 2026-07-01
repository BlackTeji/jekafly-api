const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
db.clubPerk.count().then(c => {
  console.log('clubPerk rows:', c);
  return db.$disconnect();
});
