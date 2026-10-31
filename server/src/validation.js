// Input validation for request bodies. Each function returns either
// { value } with cleaned-up data, or { error } with a message for the user.
const { ROUTE_ID_PATTERN, SESSION_ID_PATTERN } = require('./payload/payload');

const MERCHANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,50}$/;
// A UPI address (VPA) looks like name@bank, e.g. kesav@mockbank.
const VPA_PATTERN = /^[a-z0-9._-]{2,50}@[a-z]{2,30}$/;
const AMOUNT_PATTERN = /^\d{1,4}(\.\d{1,2})?$/; // "25", "25.5", "25.50"
const MAX_AMOUNT_PAISE = 100000; // Rs 1,000

// Converts rupees ("25.5" or 25.5) to integer paise (2550) WITHOUT float maths:
// we split the text at the dot and work with whole numbers only.
function rupeesToPaise(amount) {
  if (typeof amount !== 'number' && typeof amount !== 'string') return null;

  const text = String(amount).trim();
  if (!AMOUNT_PATTERN.test(text)) return null;

  const [rupees, fraction = ''] = text.split('.');
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, '0'));
  return paise;
}

function validateCreateSession(body) {
  const { merchantId, routeId, amount } = body || {};

  if (typeof merchantId !== 'string' || !MERCHANT_ID_PATTERN.test(merchantId)) {
    return { error: 'merchantId must be 1-50 letters, digits, "-" or "_"' };
  }
  if (typeof routeId !== 'string' || !ROUTE_ID_PATTERN.test(routeId)) {
    return { error: 'routeId must be 1-10 letters, digits or "-" (e.g. 4B)' };
  }

  const amountPaise = rupeesToPaise(amount);
  if (amountPaise === null) {
    return { error: 'amount must be a number with at most 2 decimal places' };
  }
  if (amountPaise <= 0 || amountPaise > MAX_AMOUNT_PAISE) {
    return { error: 'amount must be more than 0 and at most 1000' };
  }

  return { value: { merchantId, routeId, amountPaise } };
}

function validateAuthorize(body) {
  const { payload, pin, payerVpa } = body || {};

  if (typeof payload !== 'string' || payload.length === 0 || payload.length > 200) {
    return { error: 'payload is required' };
  }
  if (typeof pin !== 'string' || pin.length === 0) {
    return { error: 'pin is required' };
  }
  if (typeof payerVpa !== 'string' || !VPA_PATTERN.test(payerVpa)) {
    return { error: 'payerVpa must look like name@bank' };
  }
  return { value: { payload, pin, payerVpa } };
}

function isSessionId(text) {
  return typeof text === 'string' && SESSION_ID_PATTERN.test(text);
}

module.exports = { validateCreateSession, validateAuthorize, isSessionId, rupeesToPaise };
