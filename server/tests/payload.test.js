const {
  buildPayload,
  parsePayload,
  verifySignature,
  MAX_PAYLOAD_BYTES,
} = require('../src/payload/payload');

const SECRET = 'test-secret';

const fields = {
  sessionId: '3f2b1c9e-8a7d-4e6f-9b0a-1c2d3e4f5a6b',
  routeId: '4B',
  amountPaise: 2500,
  expiryUnix: 1761040000,
};

describe('payload', () => {
  test('build -> parse round trip gives back the same fields', () => {
    const text = buildPayload(fields, SECRET);
    const parsed = parsePayload(text);

    expect(parsed).toMatchObject(fields);
    expect(verifySignature(parsed, SECRET)).toBe(true);
  });

  test('starts with the version prefix', () => {
    expect(buildPayload(fields, SECRET).startsWith('SP1|')).toBe(true);
  });

  test('tampered amount fails verification', () => {
    const text = buildPayload(fields, SECRET);
    const tampered = text.replace('|2500|', '|100|'); // Rs 25 -> Rs 1

    const parsed = parsePayload(tampered); // format is still valid...
    expect(parsed).not.toBeNull();
    expect(verifySignature(parsed, SECRET)).toBe(false); // ...but signature is not
  });

  test('tampered route fails verification', () => {
    const tampered = buildPayload(fields, SECRET).replace('|4B|', '|5C|');
    expect(verifySignature(parsePayload(tampered), SECRET)).toBe(false);
  });

  test('payload signed with a different secret fails verification', () => {
    const forged = buildPayload(fields, 'attacker-secret');
    expect(verifySignature(parsePayload(forged), SECRET)).toBe(false);
  });

  test.each([
    ['empty string', ''],
    ['not a string', 12345],
    ['null', null],
    ['random text', 'hello world'],
    ['wrong version', buildPayload(fields, SECRET).replace('SP1', 'SP9')],
    ['too few parts', 'SP1|abc|4B|2500'],
    ['too many parts', buildPayload(fields, SECRET) + '|extra'],
    ['bad uuid', buildPayload({ ...fields, sessionId: 'not-a-uuid' }, SECRET)],
    ['bad route', buildPayload({ ...fields, routeId: 'route with spaces' }, SECRET)],
    ['decimal amount', 'SP1|3f2b1c9e-8a7d-4e6f-9b0a-1c2d3e4f5a6b|4B|25.00|1761040000|9f86d081884c7d65'],
    ['negative amount', 'SP1|3f2b1c9e-8a7d-4e6f-9b0a-1c2d3e4f5a6b|4B|-2500|1761040000|9f86d081884c7d65'],
    ['zero amount', 'SP1|3f2b1c9e-8a7d-4e6f-9b0a-1c2d3e4f5a6b|4B|0|1761040000|9f86d081884c7d65'],
    ['short signature', 'SP1|3f2b1c9e-8a7d-4e6f-9b0a-1c2d3e4f5a6b|4B|2500|1761040000|abc'],
  ])('rejects malformed input: %s', (_label, input) => {
    expect(parsePayload(input)).toBeNull();
  });

  test('verifySignature returns false for null', () => {
    expect(verifySignature(null, SECRET)).toBe(false);
  });

  test('a typical payload stays under the ggwave size limit', () => {
    // Use the longest route id we allow and a large amount to be safe.
    const big = buildPayload(
      { ...fields, routeId: 'ABCDEFGHIJ', amountPaise: 100000 },
      SECRET
    );
    const bytes = Buffer.byteLength(big, 'utf8');

    expect(bytes).toBeLessThan(MAX_PAYLOAD_BYTES);
  });
});
