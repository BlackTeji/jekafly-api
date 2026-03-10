const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');

// Create a fresh axios instance per request so the secret key is always current
const paystackApi = () => axios.create({
  baseURL: config.paystack.baseUrl,
  headers: {
    Authorization: `Bearer ${config.paystack.secretKey}`,
    'Content-Type': 'application/json',
  },
});

// Initiate a Paystack transaction
const initializeTransaction = async ({ email, amount, reference, metadata, callbackUrl }) => {
  try {
    console.log('[Paystack] callback_url:', callbackUrl);
    console.log('[Paystack] FRONTEND_URL:', config.frontendUrl);
    const { data } = await paystackApi().post('/transaction/initialize', {
      email,
      amount,
      reference,
      metadata,
      callback_url: callbackUrl || `${config.frontendUrl}/payment.html`,
    });
    console.log('[Paystack] authorization_url:', data.data?.authorization_url);
    return data.data;
  } catch (err) {
    const status = err.response?.status;
    if (status === 401) throw new Error('Paystack secret key is invalid or not configured.');
    throw new Error(err.response?.data?.message || err.message || 'Paystack error');
  }
};

// Verify a transaction server-side
const verifyTransaction = async (reference) => {
  const { data } = await paystackApi().get(`/transaction/verify/${reference}`);
  return data.data; // { status, amount, reference, customer, metadata }
};

// Validate webhook signature
const validateWebhookSignature = (rawBody, signature) => {
  if (!config.paystack.webhookSecret) return false;
  const hash = crypto
    .createHmac('sha512', config.paystack.webhookSecret)
    .update(rawBody)
    .digest('hex');
  return hash === signature;
};

module.exports = { initializeTransaction, verifyTransaction, validateWebhookSignature };