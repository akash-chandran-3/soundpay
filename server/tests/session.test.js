// Route tests. The models (the only code that talks to MySQL) are replaced by
// jest.fn() mocks, so these tests run without a database. The simulated UPI
// switch runs for real, with no delay between hops.
jest.mock('../src/models/sessionModel', () => ({
  createSession: jest.fn(),
  claimForProcessing: jest.fn(),
  markAuthorized: jest.fn(),
  markFailed: jest.fn(),
  findById: jest.fn(),
  markExpired: jest.fn(),
}));
jest.mock('../src/models/upiModel', () => ({
  createTransaction: jest.fn(),
}));

const request = require('supertest');
const app = require('../src/app');
const sessions = require('../src/models/sessionModel');
const upiTransactions = require('../src/models/upiModel');
const { buildPayload, parsePayload, verifySignature } = require('../src/payload/payload');

const SECRET = 'test-secret';
const PIN = '1234';
const SESSION_ID = 'k7qm2xpa9r4t';
const PAYER = 'kesav@mockbank';

beforeAll(() => {
  process.env.PAYLOAD_SECRET = SECRET;
  process.env.MOCK_PIN = PIN;
  process.env.UPI_STEP_DELAY_MS = '0';
});

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {}); // keep 500 logs quiet
});

afterEach(() => {
  console.error.mockRestore();
});

// A genuine payload, signed with the same secret the app uses.
function validPayload(overrides = {}) {
  return buildPayload(
    {
      sessionId: SESSION_ID,
      routeId: '4B',
      amountPaise: 2500,
      expiryUnix: Math.floor(Date.now() / 1000) + 30,
      ...overrides,
    },
    SECRET
  );
}

// What findById returns for our session, with any fields overridden.
function sessionRow(overrides = {}) {
  return {
    id: SESSION_ID,
    merchant_id: 'BUS-DEPOT-1',
    route_id: '4B',
    amount_paise: 2500,
    status: 'PROCESSING',
    is_expired: 0,
    rrn: null,
    ...overrides,
  };
}

function authorize(body) {
  return request(app).post('/api/session/authorize').send(body);
}

describe('POST /api/session/create', () => {
  const good = { merchantId: 'BUS-DEPOT-1', routeId: '4B', amount: 25 };

  test('valid request -> 201 with a short sessionId and a signed SP2 payload', async () => {
    const res = await request(app).post('/api/session/create').send(good);

    expect(res.status).toBe(201);
    expect(res.body.sessionId).toMatch(/^[0-9a-z]{12}$/);
    expect(res.body.amountPaise).toBe(2500);
    expect(res.body.expiresInSeconds).toBe(30);
    expect(res.body.payload.startsWith('SP2|')).toBe(true);

    const parsed = parsePayload(res.body.payload);
    expect(parsed.sessionId).toBe(res.body.sessionId);
    expect(parsed.amountPaise).toBe(2500);
    expect(verifySignature(parsed, SECRET)).toBe(true);

    expect(sessions.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: res.body.sessionId, routeId: '4B', amountPaise: 2500 })
    );
  });

  test('two tickets get different session ids', async () => {
    const a = await request(app).post('/api/session/create').send(good);
    const b = await request(app).post('/api/session/create').send(good);

    expect(a.body.sessionId).not.toBe(b.body.sessionId);
  });

  test.each([
    ['25.5', 2550],
    [25.75, 2575],
    ['0.01', 1],
    [1000, 100000],
  ])('amount %p is stored as %p paise', async (amount, paise) => {
    const res = await request(app).post('/api/session/create').send({ ...good, amount });

    expect(res.status).toBe(201);
    expect(res.body.amountPaise).toBe(paise);
  });

  test.each([
    ['zero', 0],
    ['negative', -5],
    ['three decimals', 25.999],
    ['over Rs 1000', 1000.01],
    ['text', 'abc'],
    ['missing', undefined],
    ['boolean', true],
  ])('bad amount (%s) -> 400', async (_label, amount) => {
    const res = await request(app).post('/api/session/create').send({ ...good, amount });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/amount/);
    expect(sessions.createSession).not.toHaveBeenCalled();
  });

  test.each([
    ['missing', undefined],
    ['has a pipe', '4B|X'],
    ['has spaces', 'route 4'],
    ['too long', 'ABCDEFGHIJK'],
  ])('bad routeId (%s) -> 400', async (_label, routeId) => {
    const res = await request(app).post('/api/session/create').send({ ...good, routeId });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/routeId/);
  });

  test('invalid JSON body -> 400', async () => {
    const res = await request(app)
      .post('/api/session/create')
      .set('Content-Type', 'application/json')
      .send('{not json');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Body must be valid JSON');
  });

  test('database failure -> 500 without leaking details', async () => {
    sessions.createSession.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:3306'));

    const res = await request(app).post('/api/session/create').send(good);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Something went wrong' });
  });
});

describe('POST /api/session/authorize', () => {
  test('success -> 200 with RRN and UPI steps; session ends AUTHORIZED', async () => {
    sessions.claimForProcessing.mockResolvedValue(1);
    sessions.findById.mockResolvedValue(sessionRow());

    const res = await authorize({ payload: validPayload(), pin: PIN, payerVpa: PAYER });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'AUTHORIZED',
      sessionId: SESSION_ID,
      amountPaise: 2500,
      payerVpa: PAYER,
      payeeVpa: 'bus-depot-1@mockbank',
    });
    expect(res.body.rrn).toMatch(/^\d{12}$/);
    expect(res.body.steps.map((s) => s.step)).toContain('DEBITED');

    expect(sessions.claimForProcessing).toHaveBeenCalledWith(SESSION_ID);
    expect(upiTransactions.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION_ID, payerVpa: PAYER, amountPaise: 2500 })
    );
    expect(sessions.markAuthorized).toHaveBeenCalledWith(SESSION_ID);
    expect(sessions.markFailed).not.toHaveBeenCalled();
  });

  test('amount charged comes from the database row, not the client', async () => {
    sessions.claimForProcessing.mockResolvedValue(1);
    sessions.findById.mockResolvedValue(sessionRow({ amount_paise: 4000 }));

    const res = await authorize({ payload: validPayload(), pin: PIN, payerVpa: PAYER });

    expect(res.body.amountPaise).toBe(4000);
  });

  test('insufficient funds -> 402 with code and steps; session ends FAILED', async () => {
    sessions.claimForProcessing.mockResolvedValue(1);
    sessions.findById.mockResolvedValue(sessionRow());

    const res = await authorize({
      payload: validPayload(),
      pin: PIN,
      payerVpa: 'lowbalance@mockbank',
    });

    expect(res.status).toBe(402);
    expect(res.body.error).toBe('Insufficient funds');
    expect(res.body.code).toBe('INSUFFICIENT_FUNDS');
    expect(res.body.steps.map((s) => s.step)).toContain('DEBIT_DECLINED');
    expect(upiTransactions.createTransaction).toHaveBeenCalled(); // failures are recorded too
    expect(sessions.markFailed).toHaveBeenCalledWith(SESSION_ID);
    expect(sessions.markAuthorized).not.toHaveBeenCalled();
  });

  test('unknown payer VPA -> 402 UNKNOWN_VPA', async () => {
    sessions.claimForProcessing.mockResolvedValue(1);
    sessions.findById.mockResolvedValue(sessionRow());

    const res = await authorize({ payload: validPayload(), pin: PIN, payerVpa: 'nobody@mockbank' });

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('UNKNOWN_VPA');
  });

  test('crash while recording the transfer -> 500, session is not left PROCESSING', async () => {
    sessions.claimForProcessing.mockResolvedValue(1);
    sessions.findById.mockResolvedValue(sessionRow());
    upiTransactions.createTransaction.mockRejectedValue(new Error('DB went away'));

    const res = await authorize({ payload: validPayload(), pin: PIN, payerVpa: PAYER });

    expect(res.status).toBe(500);
    expect(sessions.markFailed).toHaveBeenCalledWith(SESSION_ID);
  });

  test('tampered amount -> 400 Invalid payload, DB never touched', async () => {
    const tampered = validPayload().replace('|2500|', '|100|');

    const res = await authorize({ payload: tampered, pin: PIN, payerVpa: PAYER });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid payload');
    expect(sessions.claimForProcessing).not.toHaveBeenCalled();
  });

  test('malformed payload -> 400 Invalid payload', async () => {
    const res = await authorize({ payload: 'hello', pin: PIN, payerVpa: PAYER });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid payload');
  });

  test('missing pin -> 400', async () => {
    const res = await authorize({ payload: validPayload(), payerVpa: PAYER });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('pin is required');
  });

  test.each([
    ['missing', undefined],
    ['no @', 'kesavmockbank'],
    ['uppercase', 'Kesav@MockBank'],
  ])('bad payerVpa (%s) -> 400', async (_label, payerVpa) => {
    const res = await authorize({ payload: validPayload(), pin: PIN, payerVpa });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/payerVpa/);
  });

  test('wrong PIN -> 401, DB never touched', async () => {
    const res = await authorize({ payload: validPayload(), pin: '0000', payerVpa: PAYER });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Wrong PIN');
    expect(sessions.claimForProcessing).not.toHaveBeenCalled();
  });

  test('second use of the same payload -> 409 Already paid', async () => {
    const payload = validPayload();

    // First request wins the atomic claim...
    sessions.claimForProcessing.mockResolvedValueOnce(1);
    sessions.findById.mockResolvedValueOnce(sessionRow());
    const first = await authorize({ payload, pin: PIN, payerVpa: PAYER });
    expect(first.status).toBe(200);

    // ...the replay claims 0 rows, and the row is already AUTHORIZED.
    sessions.claimForProcessing.mockResolvedValueOnce(0);
    sessions.findById.mockResolvedValueOnce(sessionRow({ status: 'AUTHORIZED' }));
    const second = await authorize({ payload, pin: PIN, payerVpa: PAYER });

    expect(second.status).toBe(409);
    expect(second.body.error).toBe('Already paid');
  });

  test('second request while the first is still processing -> 409', async () => {
    sessions.claimForProcessing.mockResolvedValue(0);
    sessions.findById.mockResolvedValue(sessionRow({ status: 'PROCESSING' }));

    const res = await authorize({ payload: validPayload(), pin: PIN, payerVpa: PAYER });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Payment already in progress');
  });

  test('retry after a failed payment -> 409', async () => {
    sessions.claimForProcessing.mockResolvedValue(0);
    sessions.findById.mockResolvedValue(sessionRow({ status: 'FAILED' }));

    const res = await authorize({ payload: validPayload(), pin: PIN, payerVpa: PAYER });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/failed/);
  });

  test('expired session -> 410 Expired and status is recorded', async () => {
    sessions.claimForProcessing.mockResolvedValue(0);
    sessions.findById.mockResolvedValue(sessionRow({ status: 'PENDING', is_expired: 1 }));

    const res = await authorize({ payload: validPayload(), pin: PIN, payerVpa: PAYER });

    expect(res.status).toBe(410);
    expect(res.body.error).toBe('Expired');
    expect(sessions.markExpired).toHaveBeenCalledWith(SESSION_ID);
  });

  test('signed payload for a session that does not exist -> 404', async () => {
    sessions.claimForProcessing.mockResolvedValue(0);
    sessions.findById.mockResolvedValue(null);

    const res = await authorize({ payload: validPayload(), pin: PIN, payerVpa: PAYER });

    expect(res.status).toBe(404);
  });
});

describe('GET /api/session/:id/status', () => {
  test('pending session -> PENDING', async () => {
    sessions.findById.mockResolvedValue(sessionRow({ status: 'PENDING' }));

    const res = await request(app).get(`/api/session/${SESSION_ID}/status`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'PENDING', routeId: '4B', amountPaise: 2500, rrn: null });
  });

  test('processing session -> PROCESSING', async () => {
    sessions.findById.mockResolvedValue(sessionRow({ status: 'PROCESSING' }));

    const res = await request(app).get(`/api/session/${SESSION_ID}/status`);

    expect(res.body.status).toBe('PROCESSING');
  });

  test('authorized session -> AUTHORIZED with its RRN', async () => {
    sessions.findById.mockResolvedValue(
      sessionRow({ status: 'AUTHORIZED', is_expired: 1, rrn: '482193057716' })
    );

    const res = await request(app).get(`/api/session/${SESSION_ID}/status`);

    expect(res.body.status).toBe('AUTHORIZED'); // paid stays paid after expiry time
    expect(res.body.rrn).toBe('482193057716');
  });

  test('failed session -> FAILED', async () => {
    sessions.findById.mockResolvedValue(sessionRow({ status: 'FAILED' }));

    const res = await request(app).get(`/api/session/${SESSION_ID}/status`);

    expect(res.body.status).toBe('FAILED');
  });

  test('pending but past expiry -> EXPIRED', async () => {
    sessions.findById.mockResolvedValue(sessionRow({ status: 'PENDING', is_expired: 1 }));

    const res = await request(app).get(`/api/session/${SESSION_ID}/status`);

    expect(res.body.status).toBe('EXPIRED');
    expect(sessions.markExpired).toHaveBeenCalledWith(SESSION_ID);
  });

  test('unknown session -> 404', async () => {
    sessions.findById.mockResolvedValue(null);

    const res = await request(app).get(`/api/session/${SESSION_ID}/status`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Session not found');
  });

  test.each([['abc'], ['3f2b1c9e-8a7d-4e6f-9b0a-1c2d3e4f5a6b'], ['K7QM2XPA9R4T']])(
    'id %p is not a valid session id -> 400',
    async (id) => {
      const res = await request(app).get(`/api/session/${id}/status`);

      expect(res.status).toBe(400);
      expect(sessions.findById).not.toHaveBeenCalled();
    }
  );
});

describe('GET /api/upi/demo-accounts', () => {
  test('lists the simulated payer accounts', async () => {
    const res = await request(app).get('/api/upi/demo-accounts');

    expect(res.status).toBe(200);
    expect(res.body.accounts.map((a) => a.vpa)).toEqual(['kesav@mockbank', 'lowbalance@mockbank']);
  });
});

test('unknown API route -> 404 JSON', async () => {
  const res = await request(app).get('/api/nope');

  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: 'Not found' });
});
