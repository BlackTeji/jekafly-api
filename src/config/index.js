require('dotenv').config();

function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: (() => {
    let url = process.env.FRONTEND_URL || 'http://localhost:5500';
    if (url && !url.startsWith('http')) url = 'https://' + url;
    return url.replace(/\/$/, '');
  })(),

  jwt: {
    accessSecret: process.env.NODE_ENV === 'production'
      ? requireEnv('JWT_ACCESS_SECRET')
      : (process.env.JWT_ACCESS_SECRET || (() => { console.warn('[WARN] JWT_ACCESS_SECRET not set — using insecure dev default'); return 'dev_access_secret_CHANGE_IN_PRODUCTION'; })()),
    refreshSecret: process.env.NODE_ENV === 'production'
      ? requireEnv('JWT_REFRESH_SECRET')
      : (process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret_CHANGE_IN_PRODUCTION'),
    accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES || '30d',
  },

  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'us-east-1',
    bucket: process.env.AWS_S3_BUCKET || 'jekafly-documents',
  },

  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY,
    publicKey: process.env.PAYSTACK_PUBLIC_KEY,
    webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET,
    baseUrl: 'https://api.paystack.co',
  },

  email: {
    provider: process.env.EMAIL_PROVIDER || 'smtp',
    resendKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM || 'noreply@jekafly.com',
    fromName: process.env.EMAIL_FROM_NAME || 'Jekafly',
    smtp: {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  },
};