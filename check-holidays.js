const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
db.holiday.count().then(c => {
  console.log('holiday rows:', c);
  return db.$disconnect();
});
