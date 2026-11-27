// An Error that carries an HTTP status code, so services can say
// "this is a 404" and the error handler sends the right response.
class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

module.exports = { HttpError };
