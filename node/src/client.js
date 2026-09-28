import {
  ApiError,
  AuthenticationError,
  InvalidArgumentError,
  RateLimitError,
} from './errors.js';
import { FetchHttpClient } from './http-client.js';

export const VERSION = '0.1.0';
export const DEFAULT_BASE_URL = 'https://app.zung.ai/api/mobile';
export const REPAYMENT_FREQUENCY_TYPES = Object.freeze(['days', 'weeks', 'months', 'years']);

const APPLY_PARAMS = [
  'loanProductId', 'amount', 'loanTerm', 'repaymentFrequency',
  'repaymentFrequencyType', 'agreeToTerms', 'notes',
];

/**
 * Client for the Zung Member API.
 *
 * A token belongs to ONE member and only ever sees that member's data.
 * Use an unauthenticated Client to `login()`, then `withToken()` to get a
 * client for that member. Clients are immutable; nothing here is global.
 */
export class Client {
  #baseUrl;
  #token;
  #http;

  /**
   * @param {object} [options]
   * @param {string} [options.baseUrl] Defaults to production.
   * @param {string | null} [options.token] A member token from `login()`.
   * @param {import('./http-client.js').HttpClient} [options.httpClient]
   */
  constructor({ baseUrl = DEFAULT_BASE_URL, token = null, httpClient } = {}) {
    let parsed;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new InvalidArgumentError(`"${baseUrl}" is not a valid base URL.`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new InvalidArgumentError(`"${baseUrl}" is not a valid base URL.`);
    }

    if (token !== null && (typeof token !== 'string' || token.trim() === '')) {
      throw new InvalidArgumentError('"token" must be a non-empty string.');
    }

    this.#baseUrl = baseUrl.replace(/\/+$/, '');
    this.#token = token;
    this.#http = httpClient ?? new FetchHttpClient();
  }

  /**
   * A new client acting as the member who owns `token`. Same base URL and
   * transport as this one.
   *
   * @param {string} token
   * @returns {Client}
   */
  withToken(token) {
    return new Client({ baseUrl: this.#baseUrl, token, httpClient: this.#http });
  }

  /** @returns {boolean} */
  get hasToken() {
    return this.#token !== null;
  }

  /**
   * Logs a member in. Does not change this client: pass the returned
   * `token` to `withToken()`.
   *
   * @param {{ business: string, login: string, password: string }} credentials
   *   `business` is the institution's Zung subdomain (`acme` for acme.zung.ai);
   *   `login` is the member's portal username or email.
   */
  async login({ business, login, password } = {}) {
    const body = {
      business: requireString(business, 'business'),
      login: requireString(login, 'login'),
      password: requireString(password, 'password'),
    };

    const data = await this.#send('POST', '/login', body, false);
    if (typeof data.token !== 'string' || data.token === '') {
      throw new ApiError('Zung did not return a token.', 200, data);
    }

    return data;
  }

  /** Revokes this client's token. */
  async logout() {
    return this.#send('POST', '/logout');
  }

  /** The member's profile. */
  async me() {
    return pluck(await this.#send('GET', '/me'), 'contact');
  }

  /** Balance totals across loans, savings and wallets. */
  async dashboard() {
    return this.#send('GET', '/dashboard');
  }

  /** The member's 50 most recent loans, newest first. */
  async loans() {
    return pluck(await this.#send('GET', '/loans'), 'loans');
  }

  /**
   * One loan with its full repayment schedule.
   *
   * @param {number} id
   */
  async loan(id) {
    return pluck(await this.#send('GET', `/loans/${requireId(id)}`), 'loan');
  }

  /** Active loan products the member can apply for. */
  async loanProducts() {
    return pluck(await this.#send('GET', '/loans/products'), 'products');
  }

  /** The member's 50 most recent loan applications, newest first. */
  async loanApplications() {
    return pluck(await this.#send('GET', '/loans/applications'), 'applications');
  }

  /**
   * Submits a loan application for staff review.
   *
   * @param {object} params
   * @param {number} params.loanProductId An `id` from `loanProducts()`.
   * @param {number | string} params.amount
   * @param {number} params.loanTerm
   * @param {number} params.repaymentFrequency
   * @param {'days' | 'weeks' | 'months' | 'years'} params.repaymentFrequencyType
   * @param {true} params.agreeToTerms The member's explicit consent. Must be `true`.
   * @param {string} [params.notes]
   * @returns {Promise<{ message: string, application_id: number }>}
   */
  async applyForLoan(params = {}) {
    const unknown = Object.keys(params).filter((key) => !APPLY_PARAMS.includes(key));
    if (unknown.length > 0) {
      throw new InvalidArgumentError(
        `Unknown parameter(s): ${unknown.join(', ')}. Allowed: ${APPLY_PARAMS.join(', ')}.`,
      );
    }

    const amount = params.amount;
    const numericAmount = typeof amount === 'string' && amount.trim() !== '' ? Number(amount) : amount;
    if (typeof numericAmount !== 'number' || !Number.isFinite(numericAmount)) {
      throw new InvalidArgumentError('"amount" is required and must be numeric.');
    }
    if (numericAmount <= 0) {
      throw new InvalidArgumentError('"amount" must be greater than zero.');
    }

    const type = params.repaymentFrequencyType;
    if (!REPAYMENT_FREQUENCY_TYPES.includes(type)) {
      throw new InvalidArgumentError(
        `"repaymentFrequencyType" must be one of: ${REPAYMENT_FREQUENCY_TYPES.join(', ')}.`,
      );
    }

    if (params.agreeToTerms !== true) {
      throw new InvalidArgumentError(
        '"agreeToTerms" must be true: record the member\'s consent to the loan terms before applying.',
      );
    }

    const notes = params.notes;
    if (notes !== undefined && notes !== null && typeof notes !== 'string') {
      throw new InvalidArgumentError('"notes" must be a string.');
    }

    return this.#send('POST', '/loans/apply', {
      loan_product_id: requirePositiveInt(params.loanProductId, 'loanProductId'),
      amount: numericAmount,
      loan_term: requirePositiveInt(params.loanTerm, 'loanTerm'),
      repayment_frequency: requirePositiveInt(params.repaymentFrequency, 'repaymentFrequency'),
      repayment_frequency_type: type,
      agree_to_term_and_conditions: true,
      notes: notes === '' ? null : (notes ?? null),
    });
  }

  /** The member's 50 most recent savings accounts, newest first. */
  async savingsAccounts() {
    return pluck(await this.#send('GET', '/savings'), 'savings');
  }

  /**
   * One savings account with its 50 most recent transactions.
   *
   * @param {number} id
   */
  async savingsAccount(id) {
    return pluck(await this.#send('GET', `/savings/${requireId(id)}`), 'savings');
  }

  /** The member's 50 most recent wallets, newest first. */
  async wallets() {
    return pluck(await this.#send('GET', '/wallets'), 'wallets');
  }

  /**
   * @param {string} method
   * @param {string} path
   * @param {Record<string, unknown> | null} [body]
   * @param {boolean} [authenticated]
   * @returns {Promise<Record<string, any>>}
   */
  async #send(method, path, body = null, authenticated = true) {
    const headers = {
      Accept: 'application/json',
      'User-Agent': `zung-node/${VERSION}`,
    };

    if (authenticated) {
      if (this.#token === null) {
        throw new InvalidArgumentError(
          'This client has no member token. Call login(), then withToken(result.token).',
        );
      }
      headers.Authorization = `Bearer ${this.#token}`;
    }

    let rawBody = null;
    if (method !== 'GET') {
      rawBody = JSON.stringify(body ?? {});
      headers['Content-Type'] = 'application/json';
    }

    const response = await this.#http.request(method, this.#baseUrl + path, headers, rawBody);

    let decoded = null;
    if (response.body !== '') {
      try {
        decoded = JSON.parse(response.body);
      } catch {
        decoded = null;
      }
    }
    const isObject = decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded);

    if (response.status < 200 || response.status >= 300) {
      const message = isObject && typeof decoded.message === 'string'
        ? decoded.message
        : `Zung API returned HTTP ${response.status}.`;
      const errorBody = isObject ? decoded : {};

      if (response.status === 401) {
        throw new AuthenticationError(message, 401, errorBody);
      }
      if (response.status === 429) {
        throw new RateLimitError(message, 429, errorBody, parseRetryAfter(response.headers?.['retry-after']));
      }
      throw new ApiError(message, response.status, errorBody);
    }

    if (!isObject) {
      throw new ApiError('Zung returned a response that is not a JSON object.', response.status);
    }

    return decoded;
  }
}

function pluck(data, key) {
  if (data[key] === null || typeof data[key] !== 'object') {
    throw new ApiError(`Zung response is missing "${key}".`, 200, data);
  }
  return data[key];
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidArgumentError(`"${name}" is required and must be a non-empty string.`);
  }
  return value;
}

function requirePositiveInt(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidArgumentError(`"${name}" is required and must be a positive integer.`);
  }
  return value;
}

function requireId(id) {
  const numeric = typeof id === 'string' && /^[0-9]+$/.test(id) ? Number(id) : id;
  return requirePositiveInt(numeric, 'id');
}

function parseRetryAfter(value) {
  if (value === undefined || value === null || !/^[0-9]+$/.test(String(value).trim())) {
    return null;
  }
  return Number(value);
}
