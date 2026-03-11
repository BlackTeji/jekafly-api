const nodemailer = require('nodemailer');
const config = require('../config');

let transporter;
const getTransporter = () => {
  if (transporter) return transporter;
  if (config.email.provider === 'resend') {
    transporter = nodemailer.createTransport({
      host: 'smtp.resend.com',
      port: 465,
      secure: true,
      auth: { user: 'resend', pass: config.email.resendKey },
    });
  } else {
    transporter = nodemailer.createTransport({
      host: config.email.smtp.host,
      port: config.email.smtp.port,
      secure: config.email.smtp.port === 465,
      auth: { user: config.email.smtp.user, pass: config.email.smtp.pass },
    });
  }
  return transporter;
};

const sendEmail = async ({ to, subject, html, text }) => {
  if (config.nodeEnv === 'development') {
    console.log(`[Email] To: ${to} | Subject: ${subject}`);
    return;
  }
  try {
    await getTransporter().sendMail({
      from: `"${config.email.fromName}" <${config.email.from}>`,
      to, subject, html, text,
    });
    console.log(`[Email] Sent: ${subject} → ${to}`);
  } catch (err) {
    console.error('[Email Error]', err.message);
  }
};

// ─── Base layout ──────────────────────────────────────────────────────────────
const layout = (content) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <!-- Header -->
        <tr>
          <td style="background:#0a1f44;padding:24px 32px;border-radius:12px 12px 0 0;text-align:center;">
            <span style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">
              ✈️ Jeka<span style="color:#e8613a;">fly</span>
            </span>
            <p style="margin:4px 0 0;color:#a0b4cc;font-size:12px;">Your Journey Simplified</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="background:#ffffff;padding:36px 32px;border-radius:0 0 12px 12px;">
            ${content}
            <hr style="border:none;border-top:1px solid #eee;margin:32px 0 20px;">
            <p style="color:#9aa5b4;font-size:12px;text-align:center;margin:0;">
              © ${new Date().getFullYear()} Jekafly · All rights reserved<br>
              <a href="${config.frontendUrl}" style="color:#e8613a;text-decoration:none;">jekafly.com</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const btn = (text, url) =>
  `<a href="${url}" style="display:inline-block;background:#e8613a;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;margin-top:8px;">${text}</a>`;

const infoRow = (label, value) =>
  `<tr>
    <td style="padding:10px 16px;font-size:13px;color:#666;border-bottom:1px solid #f0f0f0;">${label}</td>
    <td style="padding:10px 16px;font-size:13px;color:#1a1a1a;font-weight:600;border-bottom:1px solid #f0f0f0;">${value}</td>
  </tr>`;

const infoTable = (rows) =>
  `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fb;border-radius:8px;margin:20px 0;">${rows}</table>`;

// ─── Email templates ──────────────────────────────────────────────────────────
const emails = {

  welcome: async (user) => sendEmail({
    to: user.email,
    subject: '✈️ Welcome to Jekafly!',
    html: layout(`
      <h2 style="color:#0a1f44;margin:0 0 8px;">Welcome aboard, ${user.name.split(' ')[0]}! 🎉</h2>
      <p style="color:#555;line-height:1.6;">Your Jekafly account is ready. We make visa applications simple, fast, and stress-free.</p>
      <p style="color:#555;line-height:1.6;">Here's what you can do:</p>
      <ul style="color:#555;line-height:2;">
        <li>📋 Apply for visas to 50+ destinations</li>
        <li>📁 Upload and manage your documents</li>
        <li>🔔 Track your application status in real-time</li>
        <li>🛡️ Add travel insurance to your trip</li>
      </ul>
      <div style="text-align:center;margin:28px 0;">
        ${btn('Go to My Dashboard →', `${config.frontendUrl}/dashboard.html`)}
      </div>
    `),
  }),

  applicationConfirmed: async (app, user) => sendEmail({
    to: user.email,
    subject: `✅ Application Received — ${app.ref}`,
    html: layout(`
      <h2 style="color:#0a1f44;margin:0 0 8px;">Application Received ✅</h2>
      <p style="color:#555;line-height:1.6;">Hi ${user.name.split(' ')[0]}, we've received your visa application. Here's a summary:</p>
      ${infoTable(`
        ${infoRow('Reference', app.ref)}
        ${infoRow('Destination', app.destination)}
        ${infoRow('Visa Type', app.visaType || 'Standard')}
        ${infoRow('Travel Date', app.travelDate ? new Date(app.travelDate).toDateString() : '—')}
        ${infoRow('Status', '⏳ Pending Payment')}
      `)}
      <p style="color:#555;line-height:1.6;"><strong>Next step:</strong> Complete your payment to begin processing.</p>
      <div style="text-align:center;margin:28px 0;">
        ${btn('Complete Payment →', `${config.frontendUrl}/payment.html`)}
      </div>
      <p style="color:#9aa5b4;font-size:12px;">Questions? Reply to this email or contact our support team.</p>
    `),
  }),

  paymentConfirmed: async (app, payment, user) => sendEmail({
    to: user.email,
    subject: `💳 Payment Confirmed — ${app?.ref || payment.reference}`,
    html: layout(`
      <h2 style="color:#0a1f44;margin:0 0 8px;">Payment Confirmed 💳</h2>
      <p style="color:#555;line-height:1.6;">Hi ${user.name.split(' ')[0]}, your payment has been received and your application is now being processed.</p>
      ${infoTable(`
        ${infoRow('Application Ref', app?.ref || '—')}
        ${infoRow('Transaction ID', payment.reference)}
        ${infoRow('Amount Paid', `₦${((payment.amount || 0) / 100).toLocaleString()}`)}
        ${infoRow('Date', new Date().toDateString())}
        ${infoRow('Status', '✅ Confirmed')}
      `)}
      <p style="color:#555;line-height:1.6;">We'll notify you at every stage of your application. Expected processing time is <strong>3–5 business days</strong>.</p>
      <div style="text-align:center;margin:28px 0;">
        ${btn('Track My Application →', `${config.frontendUrl}/dashboard.html`)}
      </div>
    `),
  }),

  statusUpdated: async (app, statusNote, user) => {
    const labels = {
      RECEIVED: '📥 Received',
      PROCESSING: '🔄 Processing',
      EMBASSY: '🏛️ Embassy Review',
      APPROVED: '✅ Approved',
      DELIVERED: '🎉 Delivered',
      REJECTED: '❌ Rejected',
    };
    const isGood = ['APPROVED', 'DELIVERED'].includes(app.status);
    const isBad = app.status === 'REJECTED';
    const statusColor = isGood ? '#16a34a' : isBad ? '#dc2626' : '#e8613a';
    return sendEmail({
      to: user.email,
      subject: `📋 Application Update — ${app.ref}`,
      html: layout(`
        <h2 style="color:#0a1f44;margin:0 0 8px;">Application Status Update 📋</h2>
        <p style="color:#555;line-height:1.6;">Hi ${user.name.split(' ')[0]}, there's an update on your visa application.</p>
        ${infoTable(`
          ${infoRow('Reference', app.ref)}
          ${infoRow('Destination', app.destination)}
          ${infoRow('New Status', `<span style="color:${statusColor};font-weight:700;">${labels[app.status] || app.status}</span>`)}
        `)}
        ${statusNote ? `<div style="background:#f8f9fb;border-left:4px solid ${statusColor};padding:14px 18px;border-radius:0 8px 8px 0;margin:16px 0;color:#444;font-size:14px;line-height:1.6;">${statusNote}</div>` : ''}
        <div style="text-align:center;margin:28px 0;">
          ${btn('View in Dashboard →', `${config.frontendUrl}/dashboard.html`)}
        </div>
      `),
    });
  },

  consultationBooked: async (user) => sendEmail({
    to: user.email,
    subject: '📅 Consultation Payment Confirmed — Jekafly',
    html: layout(`
      <h2 style="color:#0a1f44;margin:0 0 8px;">Consultation Confirmed 📅</h2>
      <p style="color:#555;line-height:1.6;">Hi ${user.name.split(' ')[0]}, your consultation payment has been confirmed!</p>
      <p style="color:#555;line-height:1.6;">You can now book your preferred time slot with our visa experts.</p>
      <div style="text-align:center;margin:28px 0;">
        ${btn('Book My Consultation →', `${config.frontendUrl}/dashboard.html`)}
      </div>
      <p style="color:#9aa5b4;font-size:12px;">Can't find a suitable time? Reply to this email and we'll arrange something.</p>
    `),
  }),

  insurancePolicy: async (policy, user) => sendEmail({
    to: user.email,
    subject: `🛡️ Insurance Policy Confirmed — ${policy.id}`,
    html: layout(`
      <h2 style="color:#0a1f44;margin:0 0 8px;">Travel Insurance Active 🛡️</h2>
      <p style="color:#555;line-height:1.6;">Hi ${user.name.split(' ')[0]}, your travel insurance policy is now active.</p>
      ${infoTable(`
        ${infoRow('Policy ID', policy.id)}
        ${infoRow('Plan', policy.plan)}
        ${infoRow('Destination', policy.destination || 'Worldwide')}
        ${infoRow('Travellers', policy.travellers || 1)}
        ${infoRow('Status', '✅ Active')}
      `)}
      <div style="text-align:center;margin:28px 0;">
        ${btn('View Dashboard →', `${config.frontendUrl}/dashboard.html`)}
      </div>
    `),
  }),

  passwordChanged: async (user) => sendEmail({
    to: user.email,
    subject: '🔒 Password Changed — Jekafly',
    html: layout(`
      <h2 style="color:#0a1f44;margin:0 0 8px;">Password Changed 🔒</h2>
      <p style="color:#555;line-height:1.6;">Hi ${user.name.split(' ')[0]}, your Jekafly account password was just changed.</p>
      <p style="color:#555;line-height:1.6;">If this was you, no action is needed.</p>
      <div style="background:#fff3f3;border-left:4px solid #dc2626;padding:14px 18px;border-radius:0 8px 8px 0;margin:16px 0;color:#444;font-size:14px;">
        ⚠️ If you did <strong>not</strong> make this change, please contact us immediately.
      </div>
    `),
  }),
};

module.exports = { sendEmail, emails };