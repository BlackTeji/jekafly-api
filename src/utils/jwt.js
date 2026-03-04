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

const rotateRefreshToken = async (oldToken) => {
  const existing = await prisma.refreshToken.findUnique({ where: { token: oldToken } });
  if (!existing || existing.expiresAt < new Date()) return null;

  // Delete old, issue new
  await prisma.refreshToken.delete({ where: { token: oldToken } });
  const newToken = generateRefreshToken();
  await saveRefreshToken(existing.userId, newToken);

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