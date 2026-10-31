// All SQL for payment_sessions lives here. Every value goes in through "?"
// placeholders, so user input is never pasted into the SQL text.
//
// Time rule: we always compare against the DATABASE clock (NOW()), so the
// expiry decision has a single source of truth.
const pool = require('../db');

async function createSession({ id, merchantId, routeId, amountPaise, expiryUnix }) {
  await pool.execute(
    `INSERT INTO payment_sessions
       (id, merchant_id, route_id, amount_paise, status, expires_at)
     VALUES (?, ?, ?, ?, 'PENDING', FROM_UNIXTIME(?))`,
    [id, merchantId, routeId, amountPaise, expiryUnix]
  );
}

// The anti-replay query. Checking AND updating happen in ONE statement,
// so two requests can never both see 'PENDING'. Returns 1 if we won, else 0.
async function authorizeIfPending(id) {
  const [result] = await pool.execute(
    `UPDATE payment_sessions
        SET status = 'AUTHORIZED', authorized_at = NOW()
      WHERE id = ? AND status = 'PENDING' AND expires_at > NOW()`,
    [id]
  );
  return result.affectedRows;
}

// Returns the session (or null). is_expired is worked out by MySQL.
async function findById(id) {
  const [rows] = await pool.execute(
    `SELECT id, route_id, amount_paise, status,
            (expires_at <= NOW()) AS is_expired
       FROM payment_sessions
      WHERE id = ?`,
    [id]
  );
  return rows[0] || null;
}

// Records that an unpaid session ran out of time (keeps the status column honest).
async function markExpired(id) {
  await pool.execute(
    `UPDATE payment_sessions
        SET status = 'EXPIRED'
      WHERE id = ? AND status = 'PENDING' AND expires_at <= NOW()`,
    [id]
  );
}

module.exports = { createSession, authorizeIfPending, findById, markExpired };
