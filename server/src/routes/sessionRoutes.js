// /api/session/* endpoints. Express 5 passes errors thrown in async handlers
// to the error handler automatically, so there is no try/catch here (except
// around the UPI transfer, where we must tidy up first).
const express = require('express');
const HttpError = require('../httpError');
const sessions = require('../models/sessionModel');
const upiTransactions = require('../models/upiModel');
const mockUpi = require('../upi/mockUpi');
const { newSessionId } = require('../ids');
const { buildPayload, parsePayload, verifySignature } = require('../payload/payload');
const { validateCreateSession, validateAuthorize, isSessionId } = require('../validation');

const SESSION_SECONDS = 30;
const router = express.Router();

// How long each simulated UPI hop takes (tests set this to 0).
function upiStepDelayMs() {
  return Number(process.env.UPI_STEP_DELAY_MS ?? 300);
}

// POST /api/session/create  { merchantId, routeId, amount }
router.post('/create', async (req, res) => {
  const { value, error } = validateCreateSession(req.body);
  if (error) throw new HttpError(400, error);

  const sessionId = newSessionId();
  const expiryUnix = Math.floor(Date.now() / 1000) + SESSION_SECONDS;

  await sessions.createSession({ id: sessionId, ...value, expiryUnix });

  const payload = buildPayload(
    { sessionId, routeId: value.routeId, amountPaise: value.amountPaise, expiryUnix },
    process.env.PAYLOAD_SECRET
  );

  res.status(201).json({
    sessionId,
    payload,
    routeId: value.routeId,
    amountPaise: value.amountPaise,
    expiresInSeconds: SESSION_SECONDS,
  });
});

// POST /api/session/authorize  { payload, pin, payerVpa }
router.post('/authorize', async (req, res) => {
  const { value, error } = validateAuthorize(req.body);
  if (error) throw new HttpError(400, error);

  // 1. Is the payload genuine (made by us, not changed)?
  const parsed = parsePayload(value.payload);
  if (!parsed || !verifySignature(parsed, process.env.PAYLOAD_SECRET)) {
    throw new HttpError(400, 'Invalid payload');
  }

  // 2. Mock PIN check. A stand-in for real authentication (in real UPI the
  //    PIN is checked by the payer's bank, never by the merchant's server).
  if (value.pin !== process.env.MOCK_PIN) {
    throw new HttpError(401, 'Wrong PIN');
  }

  // 3. Atomic "PENDING -> PROCESSING". Only one request can ever win, so only
  //    one request can ever reach the (simulated) bank.
  const sessionId = parsed.sessionId;
  const claimed = await sessions.claimForProcessing(sessionId);

  if (claimed === 0) {
    // We lost. Look the row up only to explain WHY.
    const row = await sessions.findById(sessionId);
    if (!row) throw new HttpError(404, 'Session not found');
    if (row.status === 'AUTHORIZED') throw new HttpError(409, 'Already paid');
    if (row.status === 'PROCESSING') throw new HttpError(409, 'Payment already in progress');
    if (row.status === 'FAILED') {
      throw new HttpError(409, 'Payment failed for this ticket – ask for a new one');
    }

    await sessions.markExpired(sessionId);
    throw new HttpError(410, 'Expired');
  }

  // 4. Simulated UPI transfer. Amount and merchant come from OUR database,
  //    not from the client.
  const session = await sessions.findById(sessionId);
  const transfer = {
    txnRef: sessionId,
    payerVpa: value.payerVpa,
    payeeVpa: mockUpi.payeeVpaFor(session.merchant_id),
    amountPaise: session.amount_paise,
  };

  let result;
  try {
    result = await mockUpi.pay(transfer, { stepDelayMs: upiStepDelayMs() });
    await upiTransactions.createTransaction({ sessionId, ...transfer, result });
  } catch (err) {
    // Never leave a session stuck in PROCESSING.
    await sessions.markFailed(sessionId);
    throw err; // -> 500
  }

  // 5. Finish: the session's final status follows the transfer's result.
  if (result.status !== 'SUCCESS') {
    await sessions.markFailed(sessionId);
    const message =
      result.errorCode === 'INSUFFICIENT_FUNDS' ? 'Insufficient funds' : 'Payment failed';
    // 402 Payment Required: the request was fine, but the payment was declined.
    throw new HttpError(402, message, { code: result.errorCode, steps: result.steps });
  }

  await sessions.markAuthorized(sessionId);

  res.json({
    status: 'AUTHORIZED',
    sessionId,
    routeId: session.route_id,
    amountPaise: session.amount_paise,
    payerVpa: transfer.payerVpa,
    payeeVpa: transfer.payeeVpa,
    rrn: result.rrn,
    steps: result.steps,
  });
});

// GET /api/session/:id/status  -> polled every second by the terminal
router.get('/:id/status', async (req, res) => {
  const { id } = req.params;
  if (!isSessionId(id)) throw new HttpError(400, 'Invalid session id');

  const row = await sessions.findById(id);
  if (!row) throw new HttpError(404, 'Session not found');

  let status = row.status;
  if (status === 'PENDING' && row.is_expired) {
    await sessions.markExpired(id);
    status = 'EXPIRED';
  }

  res.json({
    status,
    routeId: row.route_id,
    amountPaise: row.amount_paise,
    rrn: row.rrn || null,
  });
});

module.exports = router;
