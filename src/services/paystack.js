const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');

const paystackApi = axios.create({
  baseURL: config.paystack.baseUrl,
  headers: {
    Authorization: `Bearer ${config.paystack.secretKey}`,
    'Content-Type': 'application/json',
  },
});

// Initiate a Paystack transaction
const initializeTransaction = async ({ email, amount, reference, metadata, callbackUrl }) => {
  const { data } = await paystackApi.post('/transaction/initialize', {
    email,
    amount,          // in kobo
    reference,
    metadata,
    callback_url: callbackUrl || `${config.frontendUrl}/payment.html`,
  });
  return data.data; // { authorization_url, access_code, reference }
};

// Verify a transaction server-side
const verifyTransaction = async (reference) => {
  const { data } = await paystackApi.get(`/transaction/verify/${reference}`);
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
