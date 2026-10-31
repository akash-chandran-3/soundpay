// An Error that also carries an HTTP status code.
// Routes `throw new HttpError(409, 'Already paid')` and the central error
// handler turns it into a JSON response.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = HttpError;
