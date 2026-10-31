// MySQL connection settings from .env, shared by db.js and scripts/initDb.js.
//
// Local MySQL: no SSL needed.
// Cloud MySQL (e.g. Aiven): connections must be encrypted. Set DB_SSL=true, and
// put the provider's CA certificate in DB_SSL_CA so we can check we're really
// talking to their server (not someone in the middle).
function getDbConfig() {
  const config = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  };

  if (process.env.DB_SSL === 'true') {
    config.ssl = { rejectUnauthorized: true };
    if (process.env.DB_SSL_CA) {
      // Accept the PEM pasted either on several lines or with literal "\n"s.
      config.ssl.ca = process.env.DB_SSL_CA.replace(/\\n/g, '\n');
    }
  }

  return config;
}

module.exports = { getDbConfig };
