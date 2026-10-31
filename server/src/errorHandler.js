// Central error handling: every error response has the same shape { error }.

// Runs when no route matched.
function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// Express recognises an error handler by its FOUR parameters.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Errors we threw on purpose (HttpError) or bad JSON from express.json().
  if (err.status && err.status < 500) {
    const message = err.type === 'entity.parse.failed' ? 'Body must be valid JSON' : err.message;
    return res.status(err.status).json({ error: message });
  }

  // Anything else is a bug or a DB problem: log it, but don't leak details.
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
}

module.exports = { notFound, errorHandler };
