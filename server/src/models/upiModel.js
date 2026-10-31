// SQL for upi_transactions (records of SIMULATED UPI transfers).
const pool = require('../db');

async function createTransaction({ sessionId, payerVpa, payeeVpa, amountPaise, result }) {
  await pool.execute(
    `INSERT INTO upi_transactions
       (session_id, payer_vpa, payee_vpa, amount_paise, status, rrn, error_code, steps)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      payerVpa,
      payeeVpa,
      amountPaise,
      result.status,
      result.rrn,
      result.errorCode,
      JSON.stringify(result.steps),
    ]
  );
}

module.exports = { createTransaction };
