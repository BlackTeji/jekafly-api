const nodemailer = require('nodemailer');
const config = require('../config');

// Build transporter based on config
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
  } catch (err) {
    console.error('[Email Error]', err.message);
    // Don't throw — email failure shouldn't break the API response
  }
};

// ─── Email templates ──────────────────────────────────────────────────────────

const emails = {
  welcome: async (user) => sendEmail({
    to: user.email,
    subject: '✈️ Welcome to Jekafly!',
    html: `<h2>Welcome, ${user.name}!</h2>
           <p>Your account has been created. You can now apply for visas and track your applications.</p>
           <p><a href="${config.frontendUrl}/dashboard.html">Go to your dashboard →</a></p>`,
  }),

  applicationConfirmed: async (app, user) => sendEmail({
    to: user.email,
    subject: `✅ Application Received — ${app.ref}`,
    html: `<h2>Application Confirmed</h2>
           <p>Hi ${user.name}, we've received your visa application for <strong>${app.destination}</strong>.</p>
           <p><strong>Reference:</strong> ${app.ref}</p>
           <p><strong>Next step:</strong> Complete payment to begin processing.</p>
           <p><a href="${config.frontendUrl}/payment.html">Complete Payment →</a></p>`,
  }),

  paymentConfirmed: async (app, payment, user) => sendEmail({
    to: user.email,
    subject: `💳 Payment Confirmed — ${app.ref}`,
    html: `<h2>Payment Received</h2>
           <p>Hi ${user.name}, your payment of <strong>₦${(payment.amount / 100).toLocaleString()}</strong> has been confirmed.</p>
           <p><strong>Reference:</strong> ${app.ref}</p>
           <p><strong>Transaction:</strong> ${payment.reference}</p>
           <p>Your application is now being processed. We'll update you at every step.</p>`,
  }),

  statusUpdated: async (app, statusNote, user) => {
    const labels = { RECEIVED:'Received', PROCESSING:'Docs Verified', EMBASSY:'Embassy Review', APPROVED:'Approved ✅', DELIVERED:'Delivered 🎉', REJECTED:'Rejected ❌' };
    return sendEmail({
      to: user.email,
      subject: `📋 Application Update — ${app.ref}`,
      html: `<h2>Application Status Update</h2>
             <p>Hi ${user.name}, your application <strong>${app.ref}</strong> for <strong>${app.destination}</strong> has been updated.</p>
             <p><strong>New Status:</strong> ${labels[app.status] || app.status}</p>
             <p><strong>Note:</strong> ${statusNote}</p>
             <p><a href="${config.frontendUrl}/dashboard.html">View in Dashboard →</a></p>`,
    });
  },

  insurancePolicy: async (policy, user) => sendEmail({
    to: user.email,
    subject: `🛡️ Insurance Policy Confirmed — ${policy.id}`,
    html: `<h2>Insurance Policy Active</h2>
           <p>Hi ${user.name}, your travel insurance policy is now active.</p>
           <p><strong>Plan:</strong> ${policy.plan}</p>
           <p><strong>Destination:</strong> ${policy.destination || 'Worldwide'}</p>
           <p><strong>Policy ID:</strong> ${policy.id}</p>`,
  }),

  passwordChanged: async (user) => sendEmail({
    to: user.email,
    subject: '🔒 Password Changed — Jekafly',
    html: `<h2>Password Changed</h2>
           <p>Hi ${user.name}, your Jekafly account password was just changed.</p>
           <p>If this wasn't you, please contact support immediately.</p>`,
  }),
};

module.exports = { sendEmail, emails };
