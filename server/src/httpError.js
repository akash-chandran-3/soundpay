// An Error that also carries an HTTP status code.
// Routes `throw new HttpError(409, 'Already paid')` and the central error
// handler turns it into a JSON response. `details` (optional) adds extra
// fields to that response, e.g. { code: 'INSUFFICIENT_FUNDS', steps: [...] }.
class HttpError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

module.exports = HttpError;
