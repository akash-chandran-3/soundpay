// Route tests. The model (the only code that talks to MySQL) is replaced by
// jest.fn() mocks, so these tests run without a database.
jest.mock('../src/models/sessionModel', () => ({
  createSession: jest.fn(),
  authorizeIfPending: jest.fn(),
  findById: jest.fn(),
  markExpired: jest.fn(),
}));

const request = require('supertest');
const app = require('../src/app');
const sessions = require('../src/models/sessionModel');
const { buildPayload, parsePayload, verifySignature } = require('../src/payload/payload');

const SECRET = 'test-secret';
const PIN = '1234';
const SESSION_ID = '3f2b1c9e-8a7d-4e6f-9b0a-1c2d3e4f5a6b';

beforeAll(() => {
  process.env.PAYLOAD_SECRET = SECRET;
  process.env.MOCK_PIN = PIN;
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

describe('POST /api/session/create', () => {
  const good = { merchantId: 'BUS-DEPOT-1', routeId: '4B', amount: 25 };

  test('valid request -> 201 with sessionId and a signed payload', async () => {
    const res = await request(app).post('/api/session/create').send(good);

    expect(res.status).toBe(201);
    expect(res.body.amountPaise).toBe(2500);
    expect(res.body.expiresInSeconds).toBe(30);

    const parsed = parsePayload(res.body.payload);
    expect(parsed.sessionId).toBe(res.body.sessionId);
    expect(parsed.amountPaise).toBe(2500);
    expect(verifySignature(parsed, SECRET)).toBe(true);

    expect(sessions.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: res.body.sessionId, routeId: '4B', amountPaise: 2500 })
    );
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
  test('genuine payload + correct PIN -> 200 AUTHORIZED', async () => {
    sessions.authorizeIfPending.mockResolvedValue(1);

    const res = await request(app)
      .post('/api/session/authorize')
      .send({ payload: validPayload(), pin: PIN });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'AUTHORIZED', sessionId: SESSION_ID, amountPaise: 2500 });
    expect(sessions.authorizeIfPending).toHaveBeenCalledWith(SESSION_ID);
  });

  test('tampered amount -> 400 Invalid payload, DB never touched', async () => {
    const tampered = validPayload().replace('|2500|', '|100|');

    const res = await request(app)
      .post('/api/session/authorize')
      .send({ payload: tampered, pin: PIN });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid payload');
    expect(sessions.authorizeIfPending).not.toHaveBeenCalled();
  });

  test('malformed payload -> 400 Invalid payload', async () => {
    const res = await request(app)
      .post('/api/session/authorize')
      .send({ payload: 'hello', pin: PIN });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid payload');
  });

  test('missing pin -> 400', async () => {
    const res = await request(app)
      .post('/api/session/authorize')
      .send({ payload: validPayload() });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('pin is required');
  });

  test('wrong PIN -> 401, DB never touched', async () => {
    const res = await request(app)
      .post('/api/session/authorize')
      .send({ payload: validPayload(), pin: '0000' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Wrong PIN');
    expect(sessions.authorizeIfPending).not.toHaveBeenCalled();
  });

  test('second use of the same payload -> 409 Already paid', async () => {
    const payload = validPayload();

    // First request wins the atomic UPDATE...
    sessions.authorizeIfPending.mockResolvedValueOnce(1);
    const first = await request(app).post('/api/session/authorize').send({ payload, pin: PIN });
    expect(first.status).toBe(200);

    // ...the replay changes 0 rows, and the row is already AUTHORIZED.
    sessions.authorizeIfPending.mockResolvedValueOnce(0);
    sessions.findById.mockResolvedValueOnce({ id: SESSION_ID, status: 'AUTHORIZED', is_expired: 0 });
    const second = await request(app).post('/api/session/authorize').send({ payload, pin: PIN });

    expect(second.status).toBe(409);
    expect(second.body.error).toBe('Already paid');
  });

  test('expired session -> 410 Expired and status is recorded', async () => {
    sessions.authorizeIfPending.mockResolvedValue(0);
    sessions.findById.mockResolvedValue({ id: SESSION_ID, status: 'PENDING', is_expired: 1 });

    const res = await request(app)
      .post('/api/session/authorize')
      .send({ payload: validPayload(), pin: PIN });

    expect(res.status).toBe(410);
    expect(res.body.error).toBe('Expired');
    expect(sessions.markExpired).toHaveBeenCalledWith(SESSION_ID);
  });

  test('signed payload for a session that does not exist -> 404', async () => {
    sessions.authorizeIfPending.mockResolvedValue(0);
    sessions.findById.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/session/authorize')
      .send({ payload: validPayload(), pin: PIN });

    expect(res.status).toBe(404);
  });
});

describe('GET /api/session/:id/status', () => {
  test('pending session -> PENDING', async () => {
    sessions.findById.mockResolvedValue({
      id: SESSION_ID, route_id: '4B', amount_paise: 2500, status: 'PENDING', is_expired: 0,
    });

    const res = await request(app).get(`/api/session/${SESSION_ID}/status`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'PENDING', routeId: '4B', amountPaise: 2500 });
  });

  test('authorized session -> AUTHORIZED', async () => {
    sessions.findById.mockResolvedValue({
      id: SESSION_ID, route_id: '4B', amount_paise: 2500, status: 'AUTHORIZED', is_expired: 1,
    });

    const res = await request(app).get(`/api/session/${SESSION_ID}/status`);

    expect(res.body.status).toBe('AUTHORIZED'); // paid stays paid after expiry time
  });

  test('pending but past expiry -> EXPIRED', async () => {
    sessions.findById.mockResolvedValue({
      id: SESSION_ID, route_id: '4B', amount_paise: 2500, status: 'PENDING', is_expired: 1,
    });

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

  test('id that is not a UUID -> 400', async () => {
    const res = await request(app).get('/api/session/abc/status');

    expect(res.status).toBe(400);
    expect(sessions.findById).not.toHaveBeenCalled();
  });
});

test('unknown route -> 404 JSON', async () => {
  const res = await request(app).get('/api/nope');

  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: 'Not found' });
});
