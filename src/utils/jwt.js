const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');
const prisma = require('./prisma');

const generateAccessToken = (userId, role) => {
  return jwt.sign({ userId, role }, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpires,
  });
};

const generateRefreshToken = () => crypto.randomBytes(64).toString('hex');

const saveRefreshToken = async (userId, token) => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

  await prisma.refreshToken.create({ data: { token, userId, expiresAt } });
};

const ROTATION_GRACE_MS = 60 * 1000;

const rotateRefreshToken = async (oldToken) => {
  const existing = await prisma.refreshToken.findUnique({ where: { token: oldToken } });
  const now = new Date();
  if (!existing || existing.expiresAt < now) return null;

  // Keep the old token valid for a short grace window instead of deleting it,
  // so parallel refreshes (several tabs, or several requests on one page) all succeed.
  const graceEnd = new Date(now.getTime() + ROTATION_GRACE_MS);
  if (existing.expiresAt > graceEnd) {
    await prisma.refreshToken.updateMany({ where: { token: oldToken }, data: { expiresAt: graceEnd } });
  }

  const newToken = generateRefreshToken();
  await saveRefreshToken(existing.userId, newToken);
  await prisma.refreshToken.deleteMany({ where: { userId: existing.userId, expiresAt: { lt: now } } }).catch(() => { });

  return { userId: existing.userId, newRefreshToken: newToken };
};

const revokeAllRefreshTokens = async (userId) => {
  await prisma.refreshToken.deleteMany({ where: { userId } });
};

const setRefreshCookie = (res, token) => {
  res.cookie('jkf_refresh', token, {
    httpOnly: true,
    secure: true,          
    sameSite: 'none',      
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',             
  });
};

const clearRefreshCookie = (res) => {
  res.clearCookie('jkf_refresh', { path: '/', secure: true, sameSite: 'none' });
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  saveRefreshToken,
  rotateRefreshToken,
  revokeAllRefreshTokens,
  setRefreshCookie,
  clearRefreshCookie,
};