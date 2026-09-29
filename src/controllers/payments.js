const { z } = require('zod');
const sse = require('../services/sse');
const sms = require('../services/sms');
const crypto = require('crypto');
const prisma = require('../utils/prisma');
const { ApiError } = require('../middleware/error');
const paystack = require('../services/paystack');
const { emails } = require('../services/email');
const config = require('../config');

const pricing = require('../services/pricing');

async function quoteFor(type, { ref, metadata, userId }) {
  const meta = metadata && typeof metadata === 'object' ? { ...metadata } : {};

  if (type === 'VISA') {
    if (!ref) throw new ApiError('Application reference is missing. Please restart your application.', 400);
    const app = await prisma.application.findUnique({ where: { ref } });
    if (!app) throw new ApiError('Application not found.', 404);
    if (app.userId !== userId) throw new ApiError('Not authorised.', 403);
    if (app.paid) throw new ApiError('This application has already been paid for.', 400);
    const extra = Array.isArray(app.travellers) ? app.travellers.length : 0;
    const q = await pricing.visaQuote(app.destination, extra);
    return { amount: q.total, applicationId: app.id, metadata: { ...meta, destination: app.destination, feeBreakdown: q } };
  }

  if (type === 'INSURANCE') {
    const q = await pricing.insuranceQuote(meta.plan, meta.travellers);
    if (!q) throw new ApiError('Please choose a valid insurance plan and number of travellers.', 400);
    return { amount: q.total, applicationId: null, metadata: { ...meta, travellers: q.travellers, quote: q } };
  }

  if (type === 'CONSULTATION') {
    const q = await pricing.consultationQuote(meta.plan || meta.package);
    if (!q) throw new ApiError('Please choose a valid consultation package.', 400);
    return { amount: q.total, applicationId: null, metadata: { ...meta, package: q.package } };
  }

  if (type === 'HOLIDAY') {
    const bookingRef = meta.bookingRef;
    if (!bookingRef) throw new ApiError('Holiday booking reference is missing. Please restart your booking.', 400);
    const booking = await prisma.holidayBooking.findUnique({ where: { ref: String(bookingRef) } });
    if (!booking || booking.userId !== userId) throw new ApiError('Holiday booking not found.', 404);
    if (booking.status !== 'PENDING') throw new ApiError('This holiday booking is no longer awaiting payment.', 400);
    return { amount: booking.totalAmount, applicationId: null, metadata: meta };
  }

  if (type === 'CLUB_MEMBERSHIP') {
    const existing = await prisma.clubMembership.findUnique({ where: { userId } });
    if (existing && existing.status === 'ACTIVE' && existing.expiryDate > new Date()) {
      throw new ApiError('You are already an active Travel Club member.', 400);
    }
    const q = await pricing.clubQuote();
    return { amount: q.total, applicationId: null, metadata: meta };
  }

  throw new ApiError('Online payment for this service is not available yet. Please contact support.', 400);
}

exports.initiate = async (req, res, next) => {
  try {
    const schema = z.object({
      type: z.enum(['VISA', 'INSURANCE', 'CONSULTATION', 'FLIGHT', 'HOTEL', 'HOLIDAY', 'CLUB_MEMBERSHIP']),
      ref: z.string().optional().nullable(),
      amount: z.number().optional(),
      email: z.string().email(),
      metadata: z.any().optional(),
    });
    const { type, ref, email, metadata } = schema.parse(req.body);

    const quote = await quoteFor(type, { ref: ref || null, metadata, userId: req.user.id });
    const amountKobo = Math.round(quote.amount * 100);
    if (!Number.isInteger(amountKobo) || amountKobo < 100) {
      throw new ApiError('Could not work out the price for this payment. Please contact support.', 400);
    }

    if (!config.paystack.secretKey) {
      throw new ApiError('Payment processing is not yet configured. Please contact support.', 503);
    }

    const reference = `JKF-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    await prisma.payment.create({
      data: {
        userId: req.user.id,
        applicationId: quote.applicationId,
        reference,
        type,
        amount: amountKobo,
        status: 'INITIATED',
        metadata: quote.metadata || {},
      },
    });

    let paystackData;
    try {
      paystackData = await paystack.initializeTransaction({
        email,
        amount: amountKobo,
        reference,
        metadata: { userId: req.user.id, ref, type, ...(quote.metadata || {}) },
        callbackUrl: type === 'CONSULTATION'
          ? `${config.frontendUrl}/dashboard?ref=${reference}`
          : `${config.frontendUrl}/payment?ref=${reference}`,
      });
    } catch (paystackErr) {
      await prisma.payment.delete({ where: { reference } }).catch(() => { });
      throw new ApiError(paystackErr.message || 'Payment gateway error. Please try again.', 502);
    }

    res.json({
      ok: true,
      data: {
        authorizationUrl: paystackData.authorization_url,
        accessCode: paystackData.access_code,
        reference: paystackData.reference,
        publicKey: config.paystack.publicKey,
        amount: quote.amount,
      },
    });
  } catch (err) { next(err); }
};

exports.webhook = async (req, res, next) => {
  try {
    const signature = req.headers['x-paystack-signature'];

    if (!paystack.validateWebhookSignature(req.body, signature)) {
      console.error('[Webhook] Invalid signature — rejecting.');
      return res.sendStatus(400);
    }

    res.sendStatus(200);

    const event = JSON.parse(req.body.toString());

    if (event.event === 'charge.success') {
      await handleChargeSuccess(event.data);
    }
  } catch (err) {
    console.error('[Webhook Error]', err.message);
  }
};

async function handleChargeSuccess(data) {
  const { reference } = data;
  const payment = await prisma.payment.findUnique({ where: { reference } });
  if (!payment || payment.status === 'SUCCESS') return;

  const verified = await paystack.verifyTransaction(reference);
  if (verified.status !== 'success') return;
  await fulfilPayment(payment, verified);
}

async function fulfilPayment(payment, verified) {
  const reference = payment.reference;
  if (Number(verified.amount) !== payment.amount) {
    console.error(`[Payment] Amount mismatch for ${reference}: paid ${verified.amount}, expected ${payment.amount}. Not fulfilled — needs manual review.`);
    await prisma.payment.updateMany({
      where: { reference, status: 'INITIATED' },
      data: { status: 'FAILED' },
    }).catch(() => { });
    return false;
  }

  const claimed = await prisma.payment.updateMany({
    where: { reference, status: { not: 'SUCCESS' } },
    data: { status: 'SUCCESS', paidAt: new Date() },
  });
  if (claimed.count === 0) return true;

  if (payment.type === 'VISA' && payment.applicationId) {
    const [app, docCount] = await Promise.all([
      prisma.application.update({
        where: { id: payment.applicationId },
        data: {
          paid: true,
          fee: payment.amount,
          status: 'PROCESSING',
          statusHistory: {
            create: {
              status: 'PROCESSING',
              note: 'Payment confirmed. Application now under expert review.',
            },
          },
        },
      }),
      prisma.document.count({
        where: { applicationId: payment.applicationId },
      }),
    ]);

    const user = await prisma.user.findUnique({
      where: { id: payment.userId },
      select: { name: true, email: true, phone: true },
    });
    if (user) await emails.paymentConfirmed(app, payment, user, docCount > 0).catch(() => { });
    emails.adminPaymentConfirmed(app, payment, user).catch(() => { });
    if (user?.phone) sms.paymentConfirmed(user.phone, user.name, app.ref, payment.amount / 100).catch(() => { });

    if (app.userId) sse.sendToUser(app.userId, 'payment:confirmed', {
      ref: app.ref,
      amount: payment.amount / 100,
      ts: new Date().toISOString(),
    });

    await creditAffiliateCommission(app, payment.amount).catch((err) => {
      console.error('[Affiliate Commission Error]', err.message);
    });
  }

  if (payment.type === 'INSURANCE') {
    const meta = payment.metadata || {};

    const policy = await prisma.insurancePolicy.create({
      data: {
        userId: payment.userId,
        paymentRef: reference,
        plan: meta.plan || 'Standard',
        destination: meta.destination || meta.dest,
        travelDate: meta.date ? new Date(meta.date) : null,
        travellers: parseInt(meta.travellers) || 1,
        amount: payment.amount / 100,
        status: 'active',
      },
    });

    const user = await prisma.user.findUnique({
      where: { id: payment.userId },
      select: { name: true, email: true },
    });
    if (user) await emails.insurancePolicy(policy, user).catch(() => { });
  }

  if (payment.type === 'CONSULTATION') {
    const user = await prisma.user.findUnique({
      where: { id: payment.userId },
      select: { name: true, email: true },
    });
    if (user) await emails.consultationBooked(user).catch(() => { });
  }

  if (payment.type === 'HOLIDAY') {
    await handleHolidayPaymentSuccess(payment, reference).catch((err) => {
      console.error('[Holiday Payment Error]', err.message);
    });
  }

  if (payment.type === 'CLUB_MEMBERSHIP') {
    await activateClubMembership(payment.userId, payment.amount / 100, reference).catch((err) => {
      console.error('[Club Payment Error]', err.message);
    });
  }

  return true;
}

async function activateClubMembership(userId, amountPaid, paymentRef) {
  const now = new Date();
  const expiry = new Date(now);
  expiry.setFullYear(expiry.getFullYear() + 1);
  const data = { status: 'ACTIVE', startDate: now, expiryDate: expiry, amountPaid: Math.round(amountPaid), paymentRef };
  const existing = await prisma.clubMembership.findUnique({ where: { userId } });
  if (existing) return prisma.clubMembership.update({ where: { userId }, data });
  return prisma.clubMembership.create({ data: { userId, ...data } });
}

async function handleHolidayPaymentSuccess(payment, reference) {
  const meta = payment.metadata || {};
  if (!meta.bookingRef) return;

  const booking = await prisma.holidayBooking.findUnique({
    where: { ref: meta.bookingRef },
    include: { holiday: true, holidayDate: true },
  });
  if (!booking || booking.status === 'CONFIRMED') return;

  const slot = booking.holidayDate;
  const claimed = await prisma.holidayDate.updateMany({
    where: {
      id: slot.id,
      bookedCount: { lte: slot.capacity - booking.travellers },
    },
    data: { bookedCount: { increment: booking.travellers } },
  });

  if (claimed.count === 0) {
    console.error(`[Holiday] Capacity race on confirm — booking ${booking.ref} paid but slot ${slot.id} was already full. Needs manual review.`);
  }

  await prisma.holidayBooking.update({
    where: { ref: meta.bookingRef },
    data: { status: 'CONFIRMED', paymentRef: reference, paidAt: new Date() },
  });

  if (booking.membershipAdded) {
    await activateClubMembership(payment.userId, Number(booking.membershipAmount) || 0, reference);
  }

  const user = await prisma.user.findUnique({
    where: { id: payment.userId },
    select: { name: true, email: true },
  });
  if (user && typeof emails.holidayBooked === 'function') {
    await emails.holidayBooked(booking, user).catch(() => { });
  }
}

function normPassport(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
}

async function creditAffiliateCommission(app, amountKobo) {
  if (!app.referralCode) return;

  const affiliate = await prisma.affiliate.findUnique({
    where: { referralCode: app.referralCode },
  });
  if (!affiliate || affiliate.status !== 'APPROVED') return;

  if (affiliate.userId && app.userId === affiliate.userId && !app.agentSubmitted) {
    console.log(`[Affiliate] Self-referral blocked (same account) for code ${app.referralCode}.`);
    return;
  }

  const passport = normPassport(app.passportNumber);
  if (passport && affiliate.userId) {
    const own = await prisma.application.findMany({
      where: { userId: affiliate.userId, agentSubmitted: false, passportNumber: { not: null } },
      select: { passportNumber: true },
    });
    const affiliateUser = await prisma.user.findUnique({ where: { id: affiliate.userId }, select: { email: true } });
    const sameEmail = affiliateUser && app.email && affiliateUser.email.toLowerCase() === String(app.email).toLowerCase();
    if (sameEmail || own.some(o => normPassport(o.passportNumber) === passport)) {
      console.log(`[Affiliate] Self-referral blocked (affiliate's own passport/email) for code ${app.referralCode}, application ${app.ref}.`);
      return;
    }
  }

  const commission = Math.round(amountKobo * 0.08);

  await prisma.affiliate.update({
    where: { id: affiliate.id },
    data: {
      totalReferrals: { increment: 1 },
      totalEarned: { increment: commission },
      balance: { increment: commission },
    },
  });

  console.log(`[Affiliate] ₦${(commission / 100).toFixed(2)} credited to ${affiliate.referralCode} for application ${app.ref}.`);
}

exports.verify = async (req, res, next) => {
  try {
    const { reference } = req.params;

    const payment = await prisma.payment.findUnique({ where: { reference } });
    if (!payment) throw new ApiError('Payment not found.', 404);
    if (payment.userId !== req.user.id) throw new ApiError('Not authorised.', 403);

    const verified = await paystack.verifyTransaction(reference);

    let status = verified.status;
    if (verified.status === 'success' && payment.status !== 'SUCCESS') {
      const ok = await fulfilPayment(payment, verified);
      if (!ok) status = 'amount_mismatch';
    }

    let appRef = null;
    if (payment.applicationId) {
      const app = await prisma.application.findUnique({
        where: { id: payment.applicationId },
        select: { ref: true },
      });
      appRef = app?.ref;
    }

    const fresh = await prisma.payment.findUnique({ where: { reference }, select: { paidAt: true } });

    res.json({
      ok: true,
      data: {
        status,
        amount: verified.amount / 100,
        reference,
        ref: appRef,
        receipt: {
          txRef: reference,
          amount: verified.amount / 100,
          paidAt: fresh?.paidAt || new Date(),
          metadata: payment.metadata,
        },
      },
    });
  } catch (err) { next(err); }
};

exports.list = async (req, res, next) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { userId: req.user.id },
      orderBy: { initiatedAt: 'desc' },
      include: { application: { select: { ref: true, destination: true } } },
    });

    res.json({
      ok: true,
      data: {
        payments: payments.map(p => ({
          reference: p.reference,
          type: p.type,
          amount: p.amount / 100,
          status: p.status,
          paidAt: p.paidAt,
          createdAt: p.initiatedAt,
          ref: p.application?.ref || null,
          destination: p.application?.destination || null,
          metadata: p.metadata || {},
        })),
      },
    });
  } catch (err) { next(err); }
};