const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

const fixes = [
  { id: 'f3035bd5-2de4-4b66-87f9-ab1296b5ff30', state: 'Kogi State' },
  { id: '2eb45af0-7520-45d5-a262-6fc03eb6bd45', state: 'Kano State' },
  { id: 'e7a3150c-c1b6-4fbe-bd11-c54d4da5dd64', state: 'Yobe State' },
];

(async () => {
  for (const f of fixes) {
    const updated = await db.holiday.update({
      where: { id: f.id },
      data: { state: f.state },
    });
    console.log(`Fixed ${updated.id}: ${updated.state}`);
  }
  await db.$disconnect();
})();
