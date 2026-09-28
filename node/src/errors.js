/**
 * Base class for every error this library throws. Catch this to handle
 * anything Zung-related with a single `catch`.
 */
export class ZungError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * The caller passed something the library can tell is wrong before any
 * network request is made (missing token, non-numeric amount...).
 */
export class InvalidArgumentError extends ZungError {}

/**
 * The Zung API answered, but not with a success. Carries the HTTP status
 * and whatever JSON body came back so callers can inspect it.
 */
export class ApiError extends ZungError {
  /**
   * @param {string} message
   * @param {number} statusCode
   * @param {Record<string, unknown>} body Decoded JSON response body, if there was one.
   */
  constructor(message, statusCode = 0, body = {}) {
    super(message);
    this.statusCode = statusCode;
    this.body = body;
  }
}

/**
 * HTTP 401: wrong login/password on `login()`, or a missing, invalid or
 * revoked token on anything else. Send the member back to sign in.
 */
export class AuthenticationError extends ApiError {}

/**
 * HTTP 429: a rate limit was hit. `retryAfter` is the number of seconds the
 * API asked you to wait, or null if it didn't say.
 */
export class RateLimitError extends ApiError {
  /**
   * @param {string} message
   * @param {number} statusCode
   * @param {Record<string, unknown>} body
   * @param {number | null} retryAfter
   */
  constructor(message, statusCode = 429, body = {}, retryAfter = null) {
    super(message, statusCode, body);
    this.retryAfter = retryAfter;
  }
}

/**
 * The request never got a response (DNS failure, refused connection,
 * timeout, TLS failure...).
 */
export class ConnectionError extends ZungError {}
