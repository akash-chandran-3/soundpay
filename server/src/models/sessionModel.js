// All SQL for payment_sessions lives here. Every value goes in through "?"
// placeholders, so user input is never pasted into the SQL text.
//
// Time rule: we always compare against the DATABASE clock (NOW()), so the
// expiry decision has a single source of truth.
//
// Status flow:  PENDING -> PROCESSING -> AUTHORIZED | FAILED
//               PENDING -> EXPIRED (nobody paid in time)
const pool = require('../db');

async function createSession({ id, merchantId, routeId, amountPaise, expiryUnix }) {
  await pool.execute(
    `INSERT INTO payment_sessions
       (id, merchant_id, route_id, amount_paise, status, expires_at)
     VALUES (?, ?, ?, ?, 'PENDING', FROM_UNIXTIME(?))`,
    [id, merchantId, routeId, amountPaise, expiryUnix]
  );
}

// The anti-replay query. Checking AND updating happen in ONE statement, so two
// requests can never both see 'PENDING'. Only the winner (returns 1) may go on
// to the (simulated) bank; everyone else gets 0.
async function claimForProcessing(id) {
  const [result] = await pool.execute(
    `UPDATE payment_sessions
        SET status = 'PROCESSING'
      WHERE id = ? AND status = 'PENDING' AND expires_at > NOW()`,
    [id]
  );
  return result.affectedRows;
}

// Called after the UPI transfer finishes. Only moves a PROCESSING session.
async function markAuthorized(id) {
  await pool.execute(
    `UPDATE payment_sessions
        SET status = 'AUTHORIZED', authorized_at = NOW()
      WHERE id = ? AND status = 'PROCESSING'`,
    [id]
  );
}

async function markFailed(id) {
  await pool.execute(
    `UPDATE payment_sessions
        SET status = 'FAILED'
      WHERE id = ? AND status = 'PROCESSING'`,
    [id]
  );
}

// Returns the session (or null), plus the RRN if a UPI transfer succeeded.
// is_expired is worked out by MySQL.
async function findById(id) {
  const [rows] = await pool.execute(
    `SELECT s.id, s.merchant_id, s.route_id, s.amount_paise, s.status,
            (s.expires_at <= NOW()) AS is_expired,
            t.rrn
       FROM payment_sessions s
       LEFT JOIN upi_transactions t ON t.session_id = s.id
      WHERE s.id = ?`,
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

module.exports = {
  createSession,
  claimForProcessing,
  markAuthorized,
  markFailed,
  findById,
  markExpired,
};
