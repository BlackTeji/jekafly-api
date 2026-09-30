const prisma = require('../utils/prisma');

const VISA_FEE_FALLBACK = {
  'United Kingdom': 185000, 'United States': 220000, 'Canada': 195000, 'Australia': 210000,
  'France': 160000, 'Germany': 160000, 'UAE': 95000, 'Japan': 175000,
  'China': 180000, 'South Africa': 120000, 'Italy': 155000, 'Spain': 155000,
  'Netherlands': 155000, 'Portugal': 155000, 'Belgium': 155000, 'Switzerland': 170000,
  'Sweden': 160000, 'Norway': 160000, 'Denmark': 160000, 'Turkey': 85000,
  'India': 75000, 'Brazil': 130000, 'Saudi Arabia': 90000, 'Ghana': 60000,
  'Kenya': 65000, 'Egypt': 70000,
};
const DEFAULT_VISA_FEE = 120000;
const EXTRA_TRAVELLER_RATE = 0.85;
const MAX_TRAVELLERS = 20;

const PRICING_DEFAULTS = {
  consultStandard: 15000,
  consultPriority: 25000,
  consultVip: 50000,
  insuranceBasic: 25000,
  insuranceStandard: 45000,
  insurancePremium: 80000,
  processingFeePercent: 5,
  clubMembershipFee: 150000,
};

async function getPricing() {
  const row = await prisma.pricingConfig.findUnique({ where: { id: 'singleton' } });
  const out = { ...PRICING_DEFAULTS };
  if (row) {
    for (const k of Object.keys(PRICING_DEFAULTS)) {
      if (row[k] !== null && row[k] !== undefined) out[k] = row[k];
    }
  }
  return out;
}

async function visaQuote(destination, extraTravellers) {
  const extra = Math.max(0, Math.min(MAX_TRAVELLERS, parseInt(extraTravellers, 10) || 0));
  const [feeRow, svcRow] = await Promise.all([
    prisma.fee.findUnique({ where: { country: String(destination || '') } }),
    prisma.serviceFee.findUnique({ where: { id: 'singleton' } }),
  ]);
  const visaFee = feeRow && feeRow.amount > 0
    ? feeRow.amount
    : (VISA_FEE_FALLBACK[destination] || DEFAULT_VISA_FEE);
  if (!svcRow || svcRow.amount == null) {
    const { ApiError } = require('../middleware/error');
    throw new ApiError('The Jekafly service fee has not been set yet. Please contact support.', 503);
  }
  const serviceFee = svcRow.amount;
  const extraFee = extra * Math.round(visaFee * EXTRA_TRAVELLER_RATE);
  const subtotal = visaFee + extraFee;
  return { visaFee, extraTravellers: extra, extraFee, subtotal, serviceFee, total: subtotal + serviceFee };
}

function insurancePlanKey(plan) {
  const p = String(plan || '').toLowerCase();
  if (p.includes('basic')) return 'basic';
  if (p.includes('premium')) return 'premium';
  if (p.includes('standard')) return 'standard';
  return null;
}

async function insuranceQuote(plan, travellers) {
  const key = insurancePlanKey(plan);
  if (!key) return null;
  const count = parseInt(travellers, 10);
  if (!Number.isInteger(count) || count < 1 || count > MAX_TRAVELLERS) return null;
  const pricing = await getPricing();
  const unit = { basic: pricing.insuranceBasic, standard: pricing.insuranceStandard, premium: pricing.insurancePremium }[key];
  const planCost = unit * count;
  const processingFee = Math.round(planCost * (pricing.processingFeePercent / 100));
  return { plan: key, unit, travellers: count, planCost, processingFee, total: planCost + processingFee };
}

function consultPackageKey(plan) {
  const p = String(plan || '').toLowerCase();
  if (p.includes('vip')) return 'vip';
  if (p.includes('priority')) return 'priority';
  if (p.includes('standard')) return 'standard';
  return null;
}

async function consultationQuote(plan) {
  const key = consultPackageKey(plan);
  if (!key) return null;
  const pricing = await getPricing();
  const total = { standard: pricing.consultStandard, priority: pricing.consultPriority, vip: pricing.consultVip }[key];
  return { package: key, total };
}

async function clubQuote() {
  const pricing = await getPricing();
  return { total: pricing.clubMembershipFee };
}

function defaultVisaFee(country) {
  return VISA_FEE_FALLBACK[country] || DEFAULT_VISA_FEE;
}

module.exports = {
  getPricing,
  defaultVisaFee,
  VISA_FEE_FALLBACK,
  DEFAULT_VISA_FEE,
  visaQuote,
  insuranceQuote,
  consultationQuote,
  clubQuote,
  MAX_TRAVELLERS,
};
