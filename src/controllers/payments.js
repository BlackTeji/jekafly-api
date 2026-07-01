const { z } = require('zod');
const sse = require('../services/sse');
const sms = require('../services/sms');
const crypto = require('crypto');
const prisma = require('../utils/prisma');
const { ApiError } = require('../middleware/error');
const paystack = require('../services/paystack');
const { emails } = require('../services/email');
const config = require('../config');

exports.initiate = async (req, res, next) => {
  try {
    const schema = z.object({
      type: z.enum(['VISA', 'INSURANCE', 'CONSULTATION', 'FLIGHT', 'HOTEL', 'HOLIDAY', 'CLUB_MEMBERSHIP']),
      ref: z.string().optional(),
      amount: z.number().min(1),
      email: z.string().email(),
      metadata: z.any().optional(),
    });
    const { type, ref, amount, email, metadata } = schema.parse(req.body);

    const amountKobo = Math.round(amount * 100);

    let applicationId = null;
    if (ref) {
      const app = await prisma.application.findUnique({ where: { ref } });
      if (!app) throw new ApiError('Application not found.', 404);
      if (app.userId !== req.user.id) throw new ApiError('Not authorised.', 403);
      applicationId = app.id;
    }

    const reference = `JKF-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    await prisma.payment.create({
      data: {
        userId: req.user.id,
        applicationId,
        reference,
        type,
        amount: amountKobo,
        status: 'INITIATED',
        metadata: metadata || {},
      },
    });

    if (!config.paystack.secretKey) {
      throw new ApiError('Payment processing is not yet configured. Please contact support.', 503);
    }

    let paystackData;
    try {
      paystackData = await paystack.initializeTransaction({
        email,
        amount: amountKobo,
        reference,
        metadata: { userId: req.user.id, ref, type, ...metadata },
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
  const { reference, amount } = data;

  const payment = await prisma.payment.findUnique({ where: { reference } });
  if (!payment || payment.status === 'SUCCESS') return;

  const verified = await paystack.verifyTransaction(reference);
  if (verified.status !== 'success') return;
  if (verified.amount !== amount) {
    console.error(`[Webhook] Amount mismatch for ${reference}`);
    return;
  }

  await prisma.payment.update({
    where: { reference },
    data: { status: 'SUCCESS', paidAt: new Date() },
  });

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
        amount: amount / 100,
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
}

async function handleHolidayPaymentSuccess(payment, reference) {
  const meta = payment.metadata || {};
  if (!meta.bookingRef) return;

  const booking = await prisma.holidayBooking.findUnique({
    where: { ref: meta.bookingRef },
    include: { holiday: true, holidayDate: true },
  });
  if (!booking || booking.status === 'CONFIRMED') return;

  await prisma.holidayBooking.update({
    where: { ref: meta.bookingRef },
    data: { status: 'CONFIRMED', paymentRef: reference },
  });

  if (meta.membershipAdded) {
    const now = new Date();
    const expiry = new Date(now);
    expiry.setFullYear(expiry.getFullYear() + 1);
    const amountPaid = Math.round(Number(meta.membershipAmount) || 0);

    const existing = await prisma.clubMembership.findUnique({ where: { userId: payment.userId } });
    if (existing) {
      await prisma.clubMembership.update({
        where: { userId: payment.userId },
        data: {
          status: 'ACTIVE',
          startDate: now,
          expiryDate: expiry,
          amountPaid: amountPaid || existing.amountPaid,
          paymentRef: reference,
        },
      });
    } else {
      await prisma.clubMembership.create({
        data: {
          userId: payment.userId,
          status: 'ACTIVE',
          startDate: now,
          expiryDate: expiry,
          amountPaid,
          paymentRef: reference,
        },
      });
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: payment.userId },
    select: { name: true, email: true },
  });
  if (user && typeof emails.holidayBooked === 'function') {
    await emails.holidayBooked(booking, user).catch(() => { });
  }
}

async function creditAffiliateCommission(app, amountKobo) {
  if (!app.referralCode) return;

  const affiliate = await prisma.affiliate.findUnique({
    where: { referralCode: app.referralCode },
  });
  if (!affiliate || affiliate.status !== 'APPROVED') return;

  if (affiliate.userId && app.userId === affiliate.userId) {
    console.log(`[Affiliate] Self-referral blocked (same account) for code ${app.referralCode}.`);
    return;
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

    if (verified.status === 'success' && payment.status !== 'SUCCESS') {
      await prisma.payment.update({
        where: { reference },
        data: { status: 'SUCCESS', paidAt: new Date() },
      });

      if (payment.type === 'VISA' && payment.applicationId) {
        await prisma.application.update({
          where: { id: payment.applicationId },
          data: {
            paid: true,
            fee: payment.amount,
            status: 'PROCESSING',
            statusHistory: {
              create: {
                status: 'PROCESSING',
                note: 'Payment confirmed via verification.',
              },
            },
          },
        });
      }

      if (payment.type === 'HOLIDAY') {
        await handleHolidayPaymentSuccess(payment, reference).catch((err) => {
          console.error('[Holiday Payment Error]', err.message);
        });
      }
    }

    let appRef = null;
    if (payment.applicationId) {
      const app = await prisma.application.findUnique({
        where: { id: payment.applicationId },
        select: { ref: true },
      });
      appRef = app?.ref;
    }

    res.json({
      ok: true,
      data: {
        status: verified.status,
        amount: verified.amount / 100,
        reference,
        ref: appRef,
        receipt: {
          txRef: reference,
          amount: verified.amount / 100,
          paidAt: payment.paidAt || new Date(),
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