// Builds the Express app but does NOT start listening.
// Tests import this file directly; server.js starts it for real.
const fs = require('fs');
const path = require('path');
const express = require('express');
const sessionRoutes = require('./routes/sessionRoutes');
const upiRoutes = require('./routes/upiRoutes');
const { notFound, errorHandler } = require('./errorHandler');

const app = express();

app.use(express.json({ limit: '10kb' })); // payloads are tiny; reject huge bodies

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/session', sessionRoutes);
app.use('/api/upi', upiRoutes);

// When deployed, Express also serves the built React app (client/dist), so the
// whole thing is one URL: same origin, no CORS. In local development Vite serves
// the client instead, and this folder may not exist.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // /terminal and /passenger are React routes, not files: answer any non-API
  // GET with index.html and let React Router pick the page.
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use(notFound);
app.use(errorHandler); // must be registered last

module.exports = app;
