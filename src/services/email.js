const axios = require('axios');
const config = require('../config');

const sendEmail = async ({ to, subject, html, text }) => {
  console.log(`[Email] Provider: ${config.email.provider} | Key: ${config.email.resendKey ? 'SET' : 'MISSING'} | From: ${config.email.from}`);
  if (config.nodeEnv === 'development') {
    console.log(`[Email] Skipped (development) -> To: ${to} | Subject: ${subject}`);
    return;
  }
  if (!config.email.resendKey) {
    console.error('[Email Error] RESEND_API_KEY not set');
    return;
  }
  try {
    const res = await axios.post('https://api.resend.com/emails', {
      from: `${config.email.fromName} <${config.email.from}>`,
      to: [to],
      subject,
      html,
      text,
    }, {
      headers: {
        'Authorization': `Bearer ${config.email.resendKey}`,
        'Content-Type': 'application/json',
      },
    });
    console.log(`[Email] Sent: ${subject} -> ${to} | ID: ${res.data?.id}`);
  } catch (err) {
    console.error('[Email Error]', err.response?.data || err.message);
  }
};

// ─── Brand ────────────────────────────────────────────────────────────────────
const LOGO_URL = 'https://jekafly.com/assets/images/JEKAFLY%20LOGO%20W-R%202.png';
const NAVY = '#0D1560';
const RED = '#E31E24';
const NAVY_LIGHT = '#1C2FBF';

// ─── Base layout ──────────────────────────────────────────────────────────────
const layout = (content) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Jekafly</title>
</head>
<body style="margin:0;padding:0;background:#F0F2F8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#F0F2F8;padding:40px 0;">
    <tr><td align="center" style="padding:0 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:580px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,${NAVY} 0%,${NAVY_LIGHT} 100%);padding:32px 40px;border-radius:16px 16px 0 0;text-align:center;">
            <img src="${LOGO_URL}" alt="Jekafly" width="148" style="display:block;margin:0 auto;max-width:148px;height:auto;" />
          </td>
        </tr>

        <!-- Red accent bar -->
        <tr>
          <td style="background:${RED};height:3px;line-height:3px;font-size:0;">&nbsp;</td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#ffffff;padding:44px 40px 36px;border-radius:0 0 16px 16px;">
            ${content}
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:36px;border-top:1px solid #EAECF4;">
              <tr>
                <td style="padding-top:24px;text-align:center;">
                  <p style="margin:0 0 6px;font-size:12px;color:#9BA5C0;letter-spacing:0.02em;">© ${new Date().getFullYear()} Jekafly. All rights reserved.</p>
                  <p style="margin:0;font-size:12px;color:#9BA5C0;">
                    Questions? <a href="mailto:support@jekafly.com" style="color:${NAVY};text-decoration:none;font-weight:600;">support@jekafly.com</a>
                    &nbsp;·&nbsp;
                    <a href="${config.frontendUrl}" style="color:${NAVY};text-decoration:none;font-weight:600;">jekafly.com</a>
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

// ─── Components ───────────────────────────────────────────────────────────────
const btn = (text, url) =>
  `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;">
    <tr>
      <td style="border-radius:10px;background:linear-gradient(135deg,${NAVY} 0%,${NAVY_LIGHT} 100%);box-shadow:0 4px 16px rgba(13,21,96,0.28);">
        <a href="${url}" style="display:inline-block;padding:15px 36px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:-0.01em;border-radius:10px;">${text}</a>
      </td>
    </tr>
  </table>`;

const badge = (text) =>
  `<div style="display:inline-block;background:rgba(13,21,96,0.06);border:1px solid rgba(13,21,96,0.12);border-radius:100px;padding:6px 16px;font-size:11px;font-weight:700;color:${NAVY};letter-spacing:0.08em;text-transform:uppercase;margin-bottom:20px;">${text}</div>`;

const infoRow = (label, value) =>
  `<tr>
    <td style="padding:11px 18px;font-size:13px;color:#6B7280;border-bottom:1px solid #F3F4F8;white-space:nowrap;width:40%;">${label}</td>
    <td style="padding:11px 18px;font-size:13px;color:#111827;font-weight:600;border-bottom:1px solid #F3F4F8;">${value}</td>
  </tr>`;

const infoTable = (rows) =>
  `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#F8F9FE;border-radius:10px;margin:20px 0;overflow:hidden;border:1px solid #EAECF4;">${rows}</table>`;

const alertBox = (icon, text, color = NAVY) =>
  `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:20px 0;">
    <tr>
      <td style="background:#F8F9FE;border-left:3px solid ${color};border-radius:0 10px 10px 0;padding:16px 20px;font-size:14px;color:#374151;line-height:1.65;">
        ${icon} ${text}
      </td>
    </tr>
  </table>`;

// ─── Email templates ──────────────────────────────────────────────────────────
const emails = {

  welcome: async (user) => sendEmail({
    to: user.email,
    subject: 'Welcome to Jekafly — Your visa journey starts here',
    html: layout(`
      ${badge('Welcome')}
      <h1 style="margin:0 0 10px;font-size:26px;font-weight:800;color:${NAVY};letter-spacing:-0.03em;line-height:1.2;">Hello, ${user.name.split(' ')[0]}.</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#4B5563;line-height:1.7;">Your Jekafly account is ready. We handle the complexity of visa applications so you can focus on the journey ahead.</p>
      ${infoTable(`
        ${infoRow('📋 Visa Applications', 'Apply to 50+ destinations with expert guidance')}
        ${infoRow('📁 Document Vault', 'Upload and manage your travel documents securely')}
        ${infoRow('🔔 Live Tracking', 'Follow your application status in real time')}
        ${infoRow('🛡️ Travel Insurance', 'Protect your trip with comprehensive coverage')}
      `)}
      <div style="text-align:center;margin:32px 0 8px;">
        ${btn('Go to My Dashboard →', `${config.frontendUrl}/dashboard.html`)}
      </div>
    `),
  }),

  applicationConfirmed: async (app, user, hasDocuments = false) => sendEmail({
    to: user.email,
    subject: `Application Received — ${app.ref}`,
    html: layout(`
      ${badge('Application Received')}
      <h1 style="margin:0 0 10px;font-size:26px;font-weight:800;color:${NAVY};letter-spacing:-0.03em;line-height:1.2;">We have your application.</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#4B5563;line-height:1.7;">Hi ${user.name.split(' ')[0]}, your visa application for <strong style="color:${NAVY};">${app.destination}</strong> has been received. Here's a summary of what was submitted.</p>
      ${infoTable(`
        ${infoRow('Reference', `<span style="font-family:monospace;font-size:14px;letter-spacing:0.05em;">${app.ref}</span>`)}
        ${infoRow('Destination', app.destination)}
        ${infoRow('Visa Type', app.visaType || 'Standard')}
        ${infoRow('Travel Date', app.travelDate ? new Date(app.travelDate).toDateString() : '—')}
        ${infoRow('Travellers', app.travellers?.length || 1)}
        ${infoRow('Documents', hasDocuments
      ? '<span style="color:#16a34a;font-weight:600;">✓ Submitted with application</span>'
      : '<span style="color:#d97706;font-weight:600;">⚠ Not yet submitted</span>'
    )}
      `)}
      ${hasDocuments
        ? alertBox('✅', `<strong>Documents received.</strong> Your documents have been submitted alongside your application. Our visa team will begin reviewing them once your payment is confirmed. You will receive an update at each stage of the process.`)
        : alertBox('📎', `<strong>Action required — upload your documents.</strong> Your application has been received, but your supporting documents have not been submitted yet. Please log in to your dashboard and upload your documents as soon as possible to avoid delays in processing your application.`, '#d97706')
      }
      <div style="text-align:center;margin:32px 0 8px;">
        ${btn(hasDocuments ? 'Complete Payment →' : 'Upload My Documents →', `${config.frontendUrl}/dashboard.html`)}
      </div>
      ${!hasDocuments ? `<p style="margin:8px 0 0;text-align:center;font-size:12px;color:#9BA5C0;">You can upload your documents from the <strong>My Applications</strong> section of your dashboard.</p>` : ''}
    `),
  }),
  paymentConfirmed: async (app, payment, user, hasDocuments = false) => sendEmail({
    to: user.email,
    subject: `Payment Confirmed — ${app?.ref || payment.reference}`,
    html: layout(`
      ${badge('Payment Confirmed')}
      <h1 style="margin:0 0 10px;font-size:26px;font-weight:800;color:${NAVY};letter-spacing:-0.03em;line-height:1.2;">Payment received.</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#4B5563;line-height:1.7;">Hi ${user.name.split(' ')[0]}, your payment has been confirmed and your application is now <strong style="color:${NAVY};">under active review</strong> by our visa team.</p>
      ${infoTable(`
        ${infoRow('Application Ref', `<span style="font-family:monospace;font-size:14px;letter-spacing:0.05em;">${app?.ref || '—'}</span>`)}
        ${infoRow('Destination', app?.destination || '—')}
        ${infoRow('Visa Type', app?.visaType || 'Standard')}
        ${infoRow('Transaction ID', `<span style="font-family:monospace;font-size:13px;">${payment.reference}</span>`)}
        ${infoRow('Amount Paid', `<strong style="color:#16a34a;">₦${((payment.amount || 0) / 100).toLocaleString()}</strong>`)}
        ${infoRow('Date', new Date().toDateString())}
        ${infoRow('Documents', hasDocuments
      ? '<span style="color:#16a34a;font-weight:600;">✓ Submitted</span>'
      : '<span style="color:#d97706;font-weight:600;">⚠ Not yet submitted</span>'
    )}
      `)}
      ${hasDocuments
        ? alertBox('✅', '<strong>Documents received.</strong> Your supporting documents are in. Our visa specialists will review everything and submit your application to the embassy. Expected processing time is <strong>3–5 business days</strong>. You will receive an email at every stage.')
        : alertBox('📎', '<strong>Action required — upload your documents now.</strong> Your payment is confirmed but your supporting documents have not been submitted yet. Your application cannot proceed to embassy review until your documents are uploaded. Please log in to your dashboard and upload them as soon as possible.', '#d97706')
      }
      <div style="text-align:center;margin:32px 0 8px;">
        ${btn(hasDocuments ? 'Track My Application →' : 'Upload My Documents →', `${config.frontendUrl}/dashboard.html`)}
      </div>
      ${!hasDocuments ? `<p style="margin:8px 0 0;text-align:center;font-size:12px;color:#9BA5C0;">Go to <strong>My Applications</strong> in your dashboard, select this application, and upload your documents.</p>` : ''}
    `),
  }),

  statusUpdated: async (app, statusNote, user) => {
    const labels = {
      RECEIVED: 'Received',
      PROCESSING: 'Docs Verification',
      EMBASSY: 'Embassy Review',
      APPROVED: 'Approved',
      DELIVERED: 'Delivered',
      REJECTED: 'Rejected',
    };
    const icons = {
      RECEIVED: '📥', PROCESSING: '🔄', EMBASSY: '🏛️',
      APPROVED: '✅', DELIVERED: '🎉', REJECTED: '❌',
    };
    const isGood = ['APPROVED', 'DELIVERED'].includes(app.status);
    const isBad = app.status === 'REJECTED';
    const statusColor = isGood ? '#16a34a' : isBad ? RED : NAVY;
    const headings = {
      RECEIVED: 'Your application has been received.',
      PROCESSING: 'Your documents are being verified.',
      EMBASSY: 'Your application is at the embassy.',
      APPROVED: 'Your visa has been approved.',
      DELIVERED: 'Your visa has been delivered.',
      REJECTED: 'An update on your application.',
    };
    return sendEmail({
      to: user.email,
      subject: `Application Update — ${app.ref}`,
      html: layout(`
        ${badge(`Status: ${labels[app.status] || app.status}`)}
        <h1 style="margin:0 0 10px;font-size:26px;font-weight:800;color:${NAVY};letter-spacing:-0.03em;line-height:1.2;">${icons[app.status] || ''} ${headings[app.status] || 'Your application has been updated.'}</h1>
        <p style="margin:0 0 24px;font-size:15px;color:#4B5563;line-height:1.7;">Hi ${user.name.split(' ')[0]}, here is the latest update on your visa application.</p>
        ${infoTable(`
          ${infoRow('Reference', `<span style="font-family:monospace;font-size:14px;letter-spacing:0.05em;">${app.ref}</span>`)}
          ${infoRow('Destination', app.destination)}
          ${infoRow('New Status', `<span style="color:${statusColor};font-weight:700;">${labels[app.status] || app.status}</span>`)}
        `)}
        ${statusNote ? alertBox('📌', statusNote, statusColor) : ''}
        <div style="text-align:center;margin:32px 0 8px;">
          ${btn('View in Dashboard →', `${config.frontendUrl}/dashboard.html`)}
        </div>
      `),
    });
  },

  consultationBooked: async (user) => sendEmail({
    to: user.email,
    subject: 'Consultation Confirmed — Jekafly',
    html: layout(`
      ${badge('Consultation Confirmed')}
      <h1 style="margin:0 0 10px;font-size:26px;font-weight:800;color:${NAVY};letter-spacing:-0.03em;line-height:1.2;">Your consultation is confirmed.</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#4B5563;line-height:1.7;">Hi ${user.name.split(' ')[0]}, your consultation payment has been received. A Jekafly visa expert will be in touch shortly to schedule your session.</p>
      ${alertBox('📅', 'Log in to your dashboard to view your consultation details and any documents your expert may need from you ahead of the session.')}
      <div style="text-align:center;margin:32px 0 8px;">
        ${btn('Go to My Dashboard →', `${config.frontendUrl}/dashboard.html`)}
      </div>
    `),
  }),

  insurancePolicy: async (policy, user) => sendEmail({
    to: user.email,
    subject: `Travel Insurance Active — Policy ${policy.id}`,
    html: layout(`
      ${badge('Insurance Active')}
      <h1 style="margin:0 0 10px;font-size:26px;font-weight:800;color:${NAVY};letter-spacing:-0.03em;line-height:1.2;">Your travel insurance is active.</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#4B5563;line-height:1.7;">Hi ${user.name.split(' ')[0]}, your travel insurance policy has been confirmed and is now active. Keep this email as your record.</p>
      ${infoTable(`
        ${infoRow('Policy ID', `<span style="font-family:monospace;font-size:13px;">${policy.id}</span>`)}
        ${infoRow('Plan', policy.plan)}
        ${infoRow('Destination', policy.destination || 'Worldwide')}
        ${infoRow('Travellers', policy.travellers || 1)}
        ${infoRow('Status', '<span style="color:#16a34a;font-weight:700;">● Active</span>')}
      `)}
      ${alertBox('🛡️', 'Travel with confidence. Your policy covers you throughout your trip. Contact <a href="mailto:support@jekafly.com" style="color:' + NAVY + ';font-weight:600;">support@jekafly.com</a> if you need your policy documents.')}
      <div style="text-align:center;margin:32px 0 8px;">
        ${btn('View My Dashboard →', `${config.frontendUrl}/dashboard.html`)}
      </div>
    `),
  }),

  affiliateApplicationReceived: async (affiliate) => sendEmail({
    to: process.env.ADMIN_EMAIL || 'admin@jekafly.com',
    subject: `New Affiliate Application — ${affiliate.name}`,
    html: layout(`
      ${badge('New Application')}
      <h1 style="margin:0 0 10px;font-size:26px;font-weight:800;color:${NAVY};letter-spacing:-0.03em;line-height:1.2;">New affiliate application.</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#4B5563;line-height:1.7;">A new affiliate application has been submitted and is awaiting your review in the admin panel.</p>
      ${infoTable(`
        ${infoRow('Name', affiliate.name)}
        ${infoRow('Email', affiliate.email)}
        ${infoRow('Phone', affiliate.phone || '—')}
        ${infoRow('Location', affiliate.location || '—')}
        ${infoRow('Channel', affiliate.channel || '—')}
        ${infoRow('Audience Size', affiliate.audienceSize || '—')}
        ${infoRow('Profile URL', affiliate.profileUrl ? `<a href="${affiliate.profileUrl}" style="color:${NAVY};font-weight:600;">View Profile ↗</a>` : '—')}
      `)}
      ${affiliate.motivation ? alertBox('💬', `<strong>Why they want to join:</strong><br>${affiliate.motivation}`) : ''}
      <div style="text-align:center;margin:32px 0 8px;">
        ${btn('Review in Admin Panel →', `${config.frontendUrl}/admin.html`)}
      </div>
    `),
  }),

  affiliateApproved: async (affiliate, magicUrl) => sendEmail({
    to: affiliate.email,
    subject: 'You are now a Jekafly Affiliate — Welcome aboard',
    html: layout(`
      ${badge('Affiliate Approved')}
      <h1 style="margin:0 0 10px;font-size:26px;font-weight:800;color:${NAVY};letter-spacing:-0.03em;line-height:1.2;">Welcome to the Jekafly Affiliate Programme.</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#4B5563;line-height:1.7;">Hi ${affiliate.name.split(' ')[0]}, your application has been reviewed and approved. You can now start earning commissions by referring clients to Jekafly.</p>
      ${infoTable(`
        ${infoRow('Your Referral Code', `<strong style="font-size:15px;letter-spacing:0.12em;color:${NAVY};font-family:monospace;">${affiliate.referralCode}</strong>`)}
        ${infoRow('Your Referral Link', `<a href="${config.frontendUrl}/?ref=${affiliate.referralCode}" style="color:${RED};font-weight:600;word-break:break-all;">${config.frontendUrl}/?ref=${affiliate.referralCode}</a>`)}
        ${infoRow('Commission Tier', 'Starter — 8% per successful referral')}
        ${infoRow('Payout Schedule', 'Weekly, every Friday')}
      `)}
      ${alertBox('🎯', '<strong>How to earn:</strong> Share your referral link across your channels. Every client who applies through your link and completes a paid visa application earns you a commission. Your tier upgrades automatically as your referrals grow.')}
      <div style="text-align:center;margin:32px 0 16px;">
        ${btn('Access My Dashboard →', magicUrl)}
      </div>
      <p style="margin:0;text-align:center;font-size:12px;color:#9BA5C0;line-height:1.6;">This access link expires in <strong>72 hours</strong>. After that, log in at <a href="${config.frontendUrl}" style="color:${NAVY};font-weight:600;text-decoration:none;">jekafly.com</a> using your email address.</p>
    `),
  }),

  affiliateRejected: async (affiliate) => sendEmail({
    to: affiliate.email,
    subject: 'Update on Your Affiliate Application — Jekafly',
    html: layout(`
      ${badge('Application Update')}
      <h1 style="margin:0 0 10px;font-size:26px;font-weight:800;color:${NAVY};letter-spacing:-0.03em;line-height:1.2;">Thank you for applying.</h1>
      <p style="margin:0 0 16px;font-size:15px;color:#4B5563;line-height:1.7;">Hi ${affiliate.name.split(' ')[0]}, thank you for your interest in the Jekafly Affiliate Programme.</p>
      <p style="margin:0 0 24px;font-size:15px;color:#4B5563;line-height:1.7;">After careful review, we are unable to approve your application at this time. This may be due to our current affiliate capacity or the information provided in your application.</p>
      ${alertBox('📬', 'You are welcome to reapply in the future. If you have questions or would like feedback on your application, reach out to us at <a href="mailto:support@jekafly.com" style="color:' + NAVY + ';font-weight:600;">support@jekafly.com</a>.')}
      <div style="text-align:center;margin:32px 0 8px;">
        ${btn('Contact Support →', `${config.frontendUrl}`)}
      </div>
    `),
  }),

  passwordChanged: async (user) => sendEmail({
    to: user.email,
    subject: 'Your Jekafly password was changed',
    html: layout(`
      ${badge('Security Alert')}
      <h1 style="margin:0 0 10px;font-size:26px;font-weight:800;color:${NAVY};letter-spacing:-0.03em;line-height:1.2;">Password updated.</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#4B5563;line-height:1.7;">Hi ${user.name.split(' ')[0]}, the password for your Jekafly account was successfully changed.</p>
      ${alertBox('⚠️', 'If you did <strong>not</strong> make this change, your account may be at risk. Contact us immediately at <a href="mailto:support@jekafly.com" style="color:' + NAVY + ';font-weight:600;">support@jekafly.com</a>.', RED)}
    `),
  }),

};

module.exports = { sendEmail, emails };