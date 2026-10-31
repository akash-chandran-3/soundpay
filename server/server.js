// Entry point: load .env, check required settings, start the server.
require('dotenv').config();
const app = require('./src/app');

for (const name of ['PAYLOAD_SECRET', 'MOCK_PIN', 'DB_NAME']) {
  if (!process.env[name]) {
    console.error(`Missing ${name} in .env (see .env.example)`);
    process.exit(1);
  }
}

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`SoundPay API running on http://localhost:${port}`);
});
