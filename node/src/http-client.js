import { ConnectionError } from './errors.js';

/**
 * @typedef {object} HttpResponse
 * @property {number} status
 * @property {string} body
 * @property {Record<string, string>} headers
 */

/**
 * @typedef {object} HttpClient
 * @property {(method: string, url: string, headers: Record<string, string>, body?: string | null) => Promise<HttpResponse>} request
 */

/**
 * Default transport, built on Node's global `fetch` (Node >= 18) only — no
 * third-party dependencies.
 *
 * Redirects are deliberately NOT followed: a request carrying a member's
 * bearer token must never be silently replayed against a different location.
 *
 * @implements {HttpClient}
 */
export class FetchHttpClient {
  /**
   * @param {{ timeoutMs?: number }} [options]
   */
  constructor({ timeoutMs = 30_000 } = {}) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * @param {string} method
   * @param {string} url
   * @param {Record<string, string>} headers
   * @param {string | null} [body]
   * @returns {Promise<HttpResponse>}
   */
  async request(method, url, headers, body = null) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ?? undefined,
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      throw new ConnectionError(`Could not reach Zung: ${error.message}`);
    } finally {
      clearTimeout(timeout);
    }

    const responseHeaders = {};
    for (const [key, value] of response.headers.entries()) {
      responseHeaders[key.toLowerCase()] = value;
    }

    const text = await response.text();

    return { status: response.status, body: text, headers: responseHeaders };
  }
}
