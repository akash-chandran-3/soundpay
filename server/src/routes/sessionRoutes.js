// /api/session/* endpoints. Express 5 passes errors thrown in async handlers
// to the error handler automatically, so there is no try/catch here.
const crypto = require('crypto');
const express = require('express');
const HttpError = require('../httpError');
const sessions = require('../models/sessionModel');
const { buildPayload, parsePayload, verifySignature } = require('../payload/payload');
const { validateCreateSession, validateAuthorize, isUuid } = require('../validation');

const SESSION_SECONDS = 30;
const router = express.Router();

// POST /api/session/create  { merchantId, routeId, amount }
router.post('/create', async (req, res) => {
  const { value, error } = validateCreateSession(req.body);
  if (error) throw new HttpError(400, error);

  const sessionId = crypto.randomUUID();
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

// POST /api/session/authorize  { payload, pin }
router.post('/authorize', async (req, res) => {
  const { value, error } = validateAuthorize(req.body);
  if (error) throw new HttpError(400, error);

  // 1. Is the payload genuine (made by us, not changed)?
  const parsed = parsePayload(value.payload);
  if (!parsed || !verifySignature(parsed, process.env.PAYLOAD_SECRET)) {
    throw new HttpError(400, 'Invalid payload');
  }

  // 2. Mock PIN check. A stand-in for real user authentication.
  if (value.pin !== process.env.MOCK_PIN) {
    throw new HttpError(401, 'Wrong PIN');
  }

  // 3. Atomic "PENDING -> AUTHORIZED". Only one request can ever win.
  const changed = await sessions.authorizeIfPending(parsed.sessionId);

  if (changed === 0) {
    // We lost. Look the row up only to explain WHY.
    const row = await sessions.findById(parsed.sessionId);
    if (!row) throw new HttpError(404, 'Session not found');
    if (row.status === 'AUTHORIZED') throw new HttpError(409, 'Already paid');

    await sessions.markExpired(parsed.sessionId);
    throw new HttpError(410, 'Expired');
  }

  res.json({
    status: 'AUTHORIZED',
    sessionId: parsed.sessionId,
    routeId: parsed.routeId,
    amountPaise: parsed.amountPaise,
  });
});

// GET /api/session/:id/status  -> polled every second by the terminal
router.get('/:id/status', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) throw new HttpError(400, 'Invalid session id');

  const row = await sessions.findById(id);
  if (!row) throw new HttpError(404, 'Session not found');

  let status = row.status;
  if (status === 'PENDING' && row.is_expired) {
    await sessions.markExpired(id);
    status = 'EXPIRED';
  }

  res.json({ status, routeId: row.route_id, amountPaise: row.amount_paise });
});

module.exports = router;
