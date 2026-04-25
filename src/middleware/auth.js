const jwt = require('jsonwebtoken');
const config = require('../config');
const { ApiError } = require('./error');
const prisma = require('../utils/prisma');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new ApiError('No token provided.', 401);
    }
    const token = authHeader.split(' ')[1];
    const payload = jwt.verify(token, config.jwt.accessSecret);

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, name: true, email: true, phone: true, role: true, adminRole: true, deletedAt: true },
    });
    if (!user || user.deletedAt) throw new ApiError('User not found.', 401);

    const { deletedAt: _, ...safeUser } = user;
    req.user = safeUser;
    next();
  } catch (err) {
    next(err);
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'ADMIN') {
    return next(new ApiError('Admin access required.', 403));
  }
  next();
};

const requireSuperAdmin = (req, res, next) => {
  if (req.user?.role !== 'ADMIN' || req.user?.adminRole !== 'super') {
    return next(new ApiError('Super admin access required.', 403));
  }
  next();
};

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return next();
    const token = authHeader.split(' ')[1];
    const payload = jwt.verify(token, config.jwt.accessSecret);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, name: true, email: true, role: true, deletedAt: true },
    });
    if (user && !user.deletedAt) {
      const { deletedAt: _, ...safeUser } = user;
      req.user = safeUser;
    }
    next();
  } catch {
    next();
  }
};

module.exports = { authenticate, requireAdmin, requireSuperAdmin, optionalAuth };