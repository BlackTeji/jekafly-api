const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../utils/prisma');
const { ApiError } = require('../middleware/error');
const { generateAccessToken, generateRefreshToken, saveRefreshToken,
        rotateRefreshToken, revokeAllRefreshTokens,
        setRefreshCookie, clearRefreshCookie } = require('../utils/jwt');
const { emails } = require('../services/email');

// ─── Validation schemas ───────────────────────────────────────────────────────
const registerSchema = z.object({
  name:     z.string().min(2, 'Name must be at least 2 characters'),
  email:    z.string().email('Invalid email address'),
  phone:    z.string().optional(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

// ─── POST /auth/register ──────────────────────────────────────────────────────
exports.register = async (req, res, next) => {
  try {
    const { name, email, phone, password } = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new ApiError('Email already registered.', 409);

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, email, phone, passwordHash, role: 'USER' },
      select: { id: true, name: true, email: true, phone: true, role: true, createdAt: true },
    });

    const accessToken   = generateAccessToken(user.id, user.role);
    const refreshToken  = generateRefreshToken();
    await saveRefreshToken(user.id, refreshToken);
    setRefreshCookie(res, refreshToken);

    await emails.welcome(user).catch(() => {}); // fire-and-forget

    res.status(201).json({ ok: true, data: { user, accessToken } });
  } catch (err) { next(err); }
};

// ─── POST /auth/login ─────────────────────────────────────────────────────────
exports.login = async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new ApiError('Invalid email or password.', 401);

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new ApiError('Invalid email or password.', 401);

    const safeUser     = { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role };
    const accessToken  = generateAccessToken(user.id, user.role);
    const refreshToken = generateRefreshToken();
    await saveRefreshToken(user.id, refreshToken);
    setRefreshCookie(res, refreshToken);

    res.json({ ok: true, data: { user: safeUser, accessToken } });
  } catch (err) { next(err); }
};

// ─── POST /auth/refresh ───────────────────────────────────────────────────────
exports.refresh = async (req, res, next) => {
  try {
    const token = req.cookies?.jkf_refresh;
    if (!token) throw new ApiError('No refresh token.', 401);

    const result = await rotateRefreshToken(token);
    if (!result) throw new ApiError('Invalid or expired refresh token.', 401);

    const user = await prisma.user.findUnique({
      where: { id: result.userId },
      select: { id: true, role: true },
    });
    if (!user) throw new ApiError('User not found.', 401);

    const accessToken = generateAccessToken(user.id, user.role);
    setRefreshCookie(res, result.newRefreshToken);

    res.json({ ok: true, data: { accessToken } });
  } catch (err) { next(err); }
};

// ─── POST /auth/logout ────────────────────────────────────────────────────────
exports.logout = async (req, res, next) => {
  try {
    await revokeAllRefreshTokens(req.user.id);
    clearRefreshCookie(res);
    res.json({ ok: true, data: { message: 'Logged out successfully.' } });
  } catch (err) { next(err); }
};

// ─── GET /auth/me ─────────────────────────────────────────────────────────────
exports.me = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, email: true, phone: true, role: true, createdAt: true },
    });
    res.json({ ok: true, data: { user } });
  } catch (err) { next(err); }
};

// ─── PATCH /auth/me ───────────────────────────────────────────────────────────
exports.updateMe = async (req, res, next) => {
  try {
    const schema = z.object({
      name:  z.string().min(2).optional(),
      phone: z.string().optional(),
    });
    const { name, phone } = schema.parse(req.body);

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { ...(name && { name }), ...(phone !== undefined && { phone }) },
      select: { id: true, name: true, email: true, phone: true, role: true },
    });
    res.json({ ok: true, data: { user } });
  } catch (err) { next(err); }
};

// ─── POST /auth/change-password ───────────────────────────────────────────────
exports.changePassword = async (req, res, next) => {
  try {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword:     z.string().min(8, 'New password must be at least 8 characters'),
    });
    const { currentPassword, newPassword } = schema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new ApiError('Current password is incorrect.', 400);

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash } });

    // Revoke all sessions — force re-login everywhere
    await revokeAllRefreshTokens(req.user.id);
    clearRefreshCookie(res);

    await emails.passwordChanged(req.user).catch(() => {});

    res.json({ ok: true, data: { message: 'Password updated. Please log in again.' } });
  } catch (err) { next(err); }
};
