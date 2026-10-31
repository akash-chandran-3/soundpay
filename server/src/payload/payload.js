// Pure functions for the compact payment payload sent over sound / QR.
//
// Format:  SP1|<sessionId>|<routeId>|<amountPaise>|<expiryUnix>|<sig>
// Example: SP1|3f2b1c9e-8a7d-4e6f-9b0a-1c2d3e4f5a6b|4B|2500|1761040000|9f86d081884c7d65
//
// "Pure" means: no database, no clock, no process.env inside. Everything the
// functions need is passed in, so they are easy to test.
const crypto = require('crypto');

const VERSION = 'SP1';
const SEPARATOR = '|';
const SIG_LENGTH = 16; // hex characters = 8 bytes of the HMAC
const MAX_PAYLOAD_BYTES = 140; // ggwave can only send small messages

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROUTE_ID_PATTERN = /^[A-Za-z0-9-]{1,10}$/; // e.g. "4B", "21G", "M-70"
const DIGITS_PATTERN = /^[0-9]{1,10}$/;
const SIG_PATTERN = /^[0-9a-f]{16}$/;

// HMAC-SHA256 over the unsigned part, cut to 16 hex chars to keep it short.
function sign(unsignedText, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(unsignedText)
    .digest('hex')
    .slice(0, SIG_LENGTH);
}

// Joins the fields in a fixed order (the order matters for the signature).
function unsignedPart({ sessionId, routeId, amountPaise, expiryUnix }) {
  return [VERSION, sessionId, routeId, amountPaise, expiryUnix].join(SEPARATOR);
}

// Builds the full payload string, signature included.
function buildPayload(fields, secret) {
  const unsigned = unsignedPart(fields);
  return unsigned + SEPARATOR + sign(unsigned, secret);
}

// Turns a string back into an object. Returns null if the shape is wrong.
// This only checks the FORMAT. It does not check the signature.
function parsePayload(text) {
  if (typeof text !== 'string') return null;

  const parts = text.trim().split(SEPARATOR);
  if (parts.length !== 6) return null;

  const [version, sessionId, routeId, amount, expiry, sig] = parts;
  if (version !== VERSION) return null;
  if (!UUID_PATTERN.test(sessionId)) return null;
  if (!ROUTE_ID_PATTERN.test(routeId)) return null;
  if (!DIGITS_PATTERN.test(amount) || !DIGITS_PATTERN.test(expiry)) return null;
  if (!SIG_PATTERN.test(sig)) return null;

  const amountPaise = Number(amount);
  if (amountPaise <= 0) return null;

  return { sessionId, routeId, amountPaise, expiryUnix: Number(expiry), sig };
}

// Recomputes the signature and compares it in constant time.
function verifySignature(parsed, secret) {
  if (!parsed) return false;

  const expected = Buffer.from(sign(unsignedPart(parsed), secret));
  const received = Buffer.from(parsed.sig);

  // timingSafeEqual throws if lengths differ, so check that first.
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
}

module.exports = {
  buildPayload,
  parsePayload,
  verifySignature,
  MAX_PAYLOAD_BYTES,
  ROUTE_ID_PATTERN,
};
