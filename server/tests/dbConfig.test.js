const { getDbConfig } = require('../src/dbConfig');

describe('getDbConfig', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  test('local MySQL: no ssl option', () => {
    delete process.env.DB_SSL;
    process.env.DB_PORT = '3306';

    const config = getDbConfig();

    expect(config.ssl).toBeUndefined();
    expect(config.port).toBe(3306);
  });

  test('cloud MySQL: ssl with certificate checking', () => {
    process.env.DB_SSL = 'true';
    delete process.env.DB_SSL_CA;

    expect(getDbConfig().ssl).toEqual({ rejectUnauthorized: true });
  });

  test('CA certificate with literal \\n is turned into real line breaks', () => {
    process.env.DB_SSL = 'true';
    process.env.DB_SSL_CA = '-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----';

    expect(getDbConfig().ssl.ca).toBe('-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----');
  });
});
