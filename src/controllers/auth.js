const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../utils/prisma');
const { ApiError } = require('../middleware/error');
const { generateAccessToken, generateRefreshToken, saveRefreshToken,
  rotateRefreshToken, revokeAllRefreshTokens,
  setRefreshCookie, clearRefreshCookie } = require('../utils/jwt');
const { emails, sendEmail } = require('../services/email');

// ─── Validation schemas ───────────────────────────────────────────────────────
const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const loginSchema = z.object({
  email: z.string().email(),
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

    const accessToken = generateAccessToken(user.id, user.role);
    const refreshToken = generateRefreshToken();
    await saveRefreshToken(user.id, refreshToken);
    setRefreshCookie(res, refreshToken);

    await emails.welcome(user).catch(() => { }); // fire-and-forget

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

    const safeUser = { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role };
    const accessToken = generateAccessToken(user.id, user.role);
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
      name: z.string().min(2).optional(),
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


// ─── In-memory OTP store (keyed by userId, expires in 10 min) ─────────────────
const otpStore = new Map(); // userId -> { otp, expiresAt }

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

// ─── POST /auth/request-password-otp ──────────────────────────────────────────
exports.requestPasswordOtp = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) throw new ApiError('User not found.', 404);

    const otp = generateOtp();
    otpStore.set(user.id, { otp, expiresAt: Date.now() + 10 * 60 * 1000 });

    // Send OTP email
    await sendEmail({
      to: user.email,
      subject: 'Your Jekafly Password Change OTP',
      html: `
        <div style="font-family:'Plus Jakarta Sans',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f7f8fc;border-radius:16px;">
          <img src="https://jekafly-frontend-verz.vercel.app/assets/images/JEKAFLY%20LOGO%20B-R%202.png" style="height:36px;margin-bottom:24px;" />
          <h2 style="color:#0a1f44;font-size:1.4rem;margin-bottom:8px;">Password Change Request</h2>
          <p style="color:#6b7280;font-size:0.9rem;margin-bottom:24px;">Use the OTP below to confirm your password change. It expires in <strong>10 minutes</strong>.</p>
          <div style="background:#0a1f44;color:#fff;font-size:2rem;font-weight:800;letter-spacing:.3em;text-align:center;padding:20px;border-radius:12px;margin-bottom:24px;">${otp}</div>
          <p style="color:#9ca3af;font-size:0.78rem;">If you did not request this, ignore this email — your password will not change.</p>
        </div>`,
    });

    res.json({ ok: true, data: { message: 'OTP sent to your email.' } });
  } catch (err) { next(err); }
};

// ─── POST /auth/change-password ── (updated to require OTP) ───────────────────
exports.changePassword = async (req, res, next) => {
  try {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8, 'New password must be at least 8 characters'),
      otp: z.string().length(6, 'OTP must be 6 digits'),
    });
    const { currentPassword, newPassword, otp } = schema.parse(req.body);

    // Verify OTP
    const stored = otpStore.get(req.user.id);
    if (!stored) throw new ApiError('No OTP found. Please request a new one.', 400);
    if (Date.now() > stored.expiresAt) {
      otpStore.delete(req.user.id);
      throw new ApiError('OTP has expired. Please request a new one.', 400);
    }
    if (stored.otp !== otp) throw new ApiError('Invalid OTP.', 400);
    otpStore.delete(req.user.id);

    // Verify current password
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new ApiError('Current password is incorrect.', 400);

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash } });

    await revokeAllRefreshTokens(req.user.id);
    clearRefreshCookie(res);
    await emails.passwordChanged(req.user).catch(() => { });

    res.json({ ok: true, data: { message: 'Password updated. Please log in again.' } });
  } catch (err) { next(err); }
};


// ─── DELETE /auth/me ── self-delete with password confirmation ────────────────
exports.deleteAccount = async (req, res, next) => {
  try {
    const schema = z.object({ password: z.string().min(1) });
    const { password } = schema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || user.deletedAt) throw new ApiError('Account not found.', 404);

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new ApiError('Password is incorrect.', 400);

    const now = new Date();

    // Archive applications
    await prisma.application.updateMany({
      where: { userId: req.user.id },
      data: { deletedAt: now, archivedUserId: req.user.id },
    });

    // Anonymise user PII
    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        name: '[Deleted User]',
        email: `deleted-${req.user.id}@jekafly.invalid`,
        phone: null,
        passwordHash: 'DELETED',
        deletedAt: now,
      },
    });

    // Revoke sessions
    await prisma.refreshToken.deleteMany({ where: { userId: req.user.id } });
    clearRefreshCookie(res);

    // Send goodbye email before anonymising (use original user object we already fetched)
    const { sendEmail } = require('../services/email');
    await sendEmail({
      to: user.email,
      subject: 'Your Jekafly account has been deleted',
      html: `<div style="font-family:'Plus Jakarta Sans',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f7f8fc;border-radius:16px;">
        <h2 style="color:#0a1f44;">Account Deleted</h2>
        <p style="color:#6b7280;">Hi ${user.name}, your Jekafly account and personal data have been permanently deleted as requested.</p>
        <p style="color:#6b7280;font-size:0.85rem;">Your visa application records have been archived for legal/compliance purposes but your personal details have been removed.</p>
        <p style="color:#9ca3af;font-size:0.78rem;margin-top:24px;">If this wasn't you, please contact support@jekafly.com immediately.</p>
      </div>`,
    }).catch(() => { });

    res.json({ ok: true, data: { message: 'Account deleted.' } });
  } catch (err) { next(err); }
};