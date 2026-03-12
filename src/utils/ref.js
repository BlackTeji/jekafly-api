const prisma = require('./prisma');
const crypto = require('crypto');

// Characters: uppercase letters + digits, excluding confusable chars (0,O,I,1,L)
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const randomSegment = (len) => {
  const bytes = crypto.randomBytes(len * 2); // extra entropy
  let result = '';
  for (let i = 0; i < bytes.length && result.length < len; i++) {
    const idx = bytes[i] % CHARSET.length;
    result += CHARSET[idx];
  }
  return result;
};

// Generate a unique, non-guessable ref: JKF-YYYY-XXXXXXXX
// e.g. JKF-2026-K7M3PQ9R
const generateRef = async () => {
  const year = new Date().getFullYear();
  const prefix = `JKF-${year}-`;

  // Retry up to 5 times in the astronomically unlikely event of collision
  for (let attempt = 0; attempt < 5; attempt++) {
    const ref = prefix + randomSegment(8);
    const exists = await prisma.application.findUnique({ where: { ref } });
    if (!exists) return ref;
  }
  // Fallback: extend to 10 chars if somehow all 5 collided
  return prefix + randomSegment(10);
};

// Generate insurance policy ID
const generatePolicyId = async () => {
  const year = new Date().getFullYear();
  const count = await prisma.insurancePolicy.count();
  return `INS-${year}-${String(count + 1).padStart(6, '0')}`;
};

module.exports = { generateRef, generatePolicyId };