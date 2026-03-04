const prisma = require('./prisma');

// Generate atomic JKF-YYYY-NNNNNN reference
const generateRef = async () => {
  const year = new Date().getFullYear();
  const prefix = `JKF-${year}-`;

  // Count all applications this year
  const count = await prisma.application.count({
    where: { ref: { startsWith: prefix } },
  });

  const seq = String(count + 1).padStart(6, '0');
  return `${prefix}${seq}`;
};

// Generate insurance policy ID
const generatePolicyId = async () => {
  const year = new Date().getFullYear();
  const count = await prisma.insurancePolicy.count();
  return `INS-${year}-${String(count + 1).padStart(6, '0')}`;
};

module.exports = { generateRef, generatePolicyId };
