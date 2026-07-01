const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
db.user.findUnique({ where: { id: 'ADMIN001' } }).then(row => {
  console.log('ADMIN001 row:', row);
  return db.$disconnect();
});
