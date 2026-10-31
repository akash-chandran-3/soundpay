// Random identifiers, made with crypto.randomInt (a secure random source,
// unlike Math.random, so they can't be predicted).
const crypto = require('crypto');

// Lowercase letters + digits only. MySQL compares text case-INsensitively by
// default, so "Ab3" and "aB3" would count as the same id; avoiding uppercase
// removes that trap. 12 characters from 36 = 36^12 ≈ 4.7 × 10^18 possible ids.
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const SESSION_ID_LENGTH = 12;

function newSessionId() {
  let id = '';
  for (let i = 0; i < SESSION_ID_LENGTH; i++) {
    id += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return id;
}

// A 12-digit number, like the RRN (Retrieval Reference Number) a real UPI
// transaction gets. Ours is random and only simulated.
function newRrn() {
  return String(crypto.randomInt(100000000000, 1000000000000));
}

module.exports = { newSessionId, newRrn, SESSION_ID_LENGTH };
