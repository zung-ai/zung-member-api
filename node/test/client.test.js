import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Client, DEFAULT_BASE_URL } from '../src/client.js';
import {
  ApiError,
  AuthenticationError,
  ConnectionError,
  InvalidArgumentError,
  RateLimitError,
  ZungError,
} from '../src/errors.js';
import { FakeHttpClient, fixture } from './support/fake-http-client.js';

const BASE = 'https://acme.test/api/mobile';
const TOKEN = '42|Kq3vT0kenValueForTestsOnly0000000000000';

function validApplication(overrides = {}) {
  return {
    loanProductId: 3,
    amount: 20000,
    loanTerm: 6,
    repaymentFrequency: 1,
    repaymentFrequencyType: 'months',
    agreeToTerms: true,
    notes: 'School fees',
    ...overrides,
  };
}

describe('Client construction', () => {
  test('defaults to production', async () => {
    const http = new FakeHttpClient().queueFixture('me');
    await new Client({ token: TOKEN, httpClient: http }).me();

    assert.equal(DEFAULT_BASE_URL, 'https://app.zung.ai/api/mobile');
    assert.equal(http.lastRequest().url, 'https://app.zung.ai/api/mobile/me');
  });

  test('strips trailing slashes from the base URL', async () => {
    const http = new FakeHttpClient().queueFixture('me');
    await new Client({ baseUrl: `${BASE}//`, token: TOKEN, httpClient: http }).me();

    assert.equal(http.lastRequest().url, `${BASE}/me`);
  });

  for (const baseUrl of ['not a url', 'ftp://acme.test/api', '']) {
    test(`rejects base URL ${JSON.stringify(baseUrl)}`, () => {
      assert.throws(() => new Client({ baseUrl }), InvalidArgumentError);
    });
  }

  for (const token of ['', '   ', 42]) {
    test(`rejects token ${JSON.stringify(token)}`, () => {
      assert.throws(() => new Client({ token }), InvalidArgumentError);
    });
  }

  test('withToken() returns a new client and leaves the original untouched', async () => {
    const http = new FakeHttpClient().queueFixture('me');
    const anonymous = new Client({ baseUrl: BASE, httpClient: http });
    const member = anonymous.withToken(TOKEN);

    assert.notEqual(member, anonymous);
    assert.equal(anonymous.hasToken, false);
    assert.equal(member.hasToken, true);

    await member.me();
    assert.equal(http.lastRequest().url, `${BASE}/me`);
    assert.equal(http.lastRequest().headers.Authorization, `Bearer ${TOKEN}`);
  });

  test('the token is not exposed as a property', () => {
    const client = new Client({ token: TOKEN });

    assert.equal(JSON.stringify(client).includes(TOKEN), false);
    assert.equal(Object.values(client).includes(TOKEN), false);
  });
});

describe('login()', () => {
  let http;
  let client;

  beforeEach(() => {
    http = new FakeHttpClient();
    client = new Client({ baseUrl: BASE, httpClient: http });
  });

  test('posts credentials and returns the token, contact and business', async () => {
    http.queueFixture('login');

    const result = await client.login({ business: 'acme', login: 'jane@example.com', password: 's3cret"\\/' });

    const request = http.lastRequest();
    assert.equal(request.method, 'POST');
    assert.equal(request.url, `${BASE}/login`);
    assert.equal(request.headers['Content-Type'], 'application/json');
    assert.equal(request.headers.Accept, 'application/json');
    assert.equal(request.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(request.body), {
      business: 'acme',
      login: 'jane@example.com',
      password: 's3cret"\\/',
    });

    assert.equal(result.token, TOKEN);
    assert.equal(result.contact.name, 'Jane Wanjiru');
    assert.equal(result.business.currency_symbol, 'KSh');
  });

  test('does not change the client it was called on', async () => {
    http.queueFixture('login');
    await client.login({ business: 'acme', login: 'jane', password: 'pw' });

    assert.equal(client.hasToken, false);
  });

  for (const field of ['business', 'login', 'password']) {
    test(`requires ${field}`, async () => {
      const credentials = { business: 'acme', login: 'jane', password: 'pw', [field]: '  ' };

      await assert.rejects(client.login(credentials), InvalidArgumentError);
      assert.equal(http.requests.length, 0);
    });
  }

  test('wrong credentials raise AuthenticationError', async () => {
    http.queueJson(401, { message: 'Invalid credentials.' });

    await assert.rejects(
      client.login({ business: 'acme', login: 'jane', password: 'wrong' }),
      (error) => error instanceof AuthenticationError
        && error instanceof ApiError
        && error.statusCode === 401
        && error.message === 'Invalid credentials.',
    );
  });

  test('a 200 without a token is an ApiError', async () => {
    http.queueJson(200, { message: 'odd' });

    await assert.rejects(client.login({ business: 'acme', login: 'jane', password: 'pw' }), ApiError);
  });
});

describe('authenticated endpoints', () => {
  let http;
  let client;

  beforeEach(() => {
    http = new FakeHttpClient();
    client = new Client({ baseUrl: BASE, token: TOKEN, httpClient: http });
  });

  const cases = [
    ['me', [], 'GET', '/me', 'me', (r) => r.account_number === 'M-000501'],
    ['dashboard', [], 'GET', '/dashboard', 'dashboard', (r) => r.loans.balance === 48000],
    ['loans', [], 'GET', '/loans', 'loans', (r) => r.length === 1 && r[0].status === 'active'],
    ['loan', [9001], 'GET', '/loans/9001', 'loan', (r) => r.schedule.length === 2 && r.schedule[1].paid_by_date === null],
    ['loanProducts', [], 'GET', '/loans/products', 'loan-products', (r) => r[0].maximum_principal === 500000],
    ['loanApplications', [], 'GET', '/loans/applications', 'loan-applications', (r) => r[0].loan_id === null],
    ['savingsAccounts', [], 'GET', '/savings', 'savings', (r) => r[0].current_balance === 27000],
    ['savingsAccount', [301], 'GET', '/savings/301', 'savings-account', (r) => r.transactions[0].type === 'Deposit'],
    ['wallets', [], 'GET', '/wallets', 'wallets', (r) => r[0].currency === 'KES'],
  ];

  for (const [method, args, httpMethod, path, fixtureName, check] of cases) {
    test(`${method}() calls ${httpMethod} ${path} and unwraps the response`, async () => {
      http.queueFixture(fixtureName);

      const result = await client[method](...args);

      const request = http.lastRequest();
      assert.equal(request.method, httpMethod);
      assert.equal(request.url, BASE + path);
      assert.equal(request.headers.Authorization, `Bearer ${TOKEN}`);
      assert.equal(request.headers.Accept, 'application/json');
      assert.match(request.headers['User-Agent'], /^zung-node\/\d+\.\d+\.\d+$/);
      assert.equal(request.body, null);
      assert.ok(check(result), `unexpected result: ${JSON.stringify(result)}`);
    });
  }

  test('logout() posts to /logout', async () => {
    http.queueJson(200, { message: 'Logged out.' });

    assert.deepEqual(await client.logout(), { message: 'Logged out.' });
    assert.equal(http.lastRequest().method, 'POST');
    assert.equal(http.lastRequest().url, `${BASE}/logout`);
  });

  test('every authenticated call fails fast without a token', async () => {
    const anonymous = new Client({ baseUrl: BASE, httpClient: http });

    for (const call of [
      () => anonymous.me(),
      () => anonymous.logout(),
      () => anonymous.loans(),
      () => anonymous.applyForLoan(validApplication()),
    ]) {
      await assert.rejects(call(), /no member token/);
    }
    assert.equal(http.requests.length, 0);
  });

  test('ids given as numeric strings are accepted', async () => {
    http.queueFixture('loan');
    await client.loan('9001');

    assert.equal(http.lastRequest().url, `${BASE}/loans/9001`);
  });

  for (const id of [0, -1, 1.5, '12abc', '../me', '', null, undefined, Number.NaN]) {
    test(`rejects id ${String(id)} without a request`, async () => {
      await assert.rejects(client.loan(id), InvalidArgumentError);
      await assert.rejects(client.savingsAccount(id), InvalidArgumentError);
      assert.equal(http.requests.length, 0);
    });
  }

  for (const [label, body] of [['missing', { something_else: [] }], ['null', { loans: null }], ['a string', { loans: 'none' }]]) {
    test(`a response whose envelope key is ${label} is an ApiError`, async () => {
      http.queueJson(200, body);

      await assert.rejects(client.loans(), (error) => error instanceof ApiError && /missing "loans"/.test(error.message));
    });
  }
});

describe('applyForLoan()', () => {
  let http;
  let client;

  beforeEach(() => {
    http = new FakeHttpClient();
    client = new Client({ baseUrl: BASE, token: TOKEN, httpClient: http });
  });

  test('maps parameters onto the API fields', async () => {
    http.queueFixture('apply', 201);

    const result = await client.applyForLoan(validApplication());

    const request = http.lastRequest();
    assert.equal(request.method, 'POST');
    assert.equal(request.url, `${BASE}/loans/apply`);
    assert.equal(request.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(request.body), {
      loan_product_id: 3,
      amount: 20000,
      loan_term: 6,
      repayment_frequency: 1,
      repayment_frequency_type: 'months',
      agree_to_term_and_conditions: true,
      notes: 'School fees',
    });
    assert.deepEqual(result, { message: 'Loan application submitted.', application_id: 78 });
  });

  test('accepts a numeric-string amount and sends a number', async () => {
    http.queueFixture('apply', 201);
    await client.applyForLoan(validApplication({ amount: '15000.50' }));

    assert.equal(JSON.parse(http.lastRequest().body).amount, 15000.5);
  });

  test('omitted or empty notes are sent as null', async () => {
    http.queueFixture('apply', 201).queueFixture('apply', 201);

    const { notes, ...withoutNotes } = validApplication();
    await client.applyForLoan(withoutNotes);
    assert.equal(JSON.parse(http.lastRequest().body).notes, null);

    await client.applyForLoan(validApplication({ notes: '' }));
    assert.equal(JSON.parse(http.lastRequest().body).notes, null);
  });

  const invalid = [
    ['unknown parameter', { loan_product_id: 3 }, /Unknown parameter/],
    ['missing amount', { amount: undefined }, /"amount"/],
    ['non-numeric amount', { amount: 'lots' }, /"amount"/],
    ['zero amount', { amount: 0 }, /greater than zero/],
    ['negative amount', { amount: -5 }, /greater than zero/],
    ['infinite amount', { amount: Infinity }, /"amount"/],
    ['missing product', { loanProductId: undefined }, /"loanProductId"/],
    ['fractional product', { loanProductId: 3.5 }, /"loanProductId"/],
    ['zero term', { loanTerm: 0 }, /"loanTerm"/],
    ['string term', { loanTerm: '6' }, /"loanTerm"/],
    ['zero frequency', { repaymentFrequency: 0 }, /"repaymentFrequency"/],
    ['unknown frequency type', { repaymentFrequencyType: 'fortnights' }, /"repaymentFrequencyType"/],
    ['singular frequency type', { repaymentFrequencyType: 'month' }, /"repaymentFrequencyType"/],
    ['no consent', { agreeToTerms: undefined }, /"agreeToTerms"/],
    ['truthy but not true consent', { agreeToTerms: 'yes' }, /"agreeToTerms"/],
    ['non-string notes', { notes: 5 }, /"notes"/],
  ];

  for (const [label, overrides, message] of invalid) {
    test(`rejects ${label} without a request`, async () => {
      await assert.rejects(
        client.applyForLoan(validApplication(overrides)),
        (error) => error instanceof InvalidArgumentError && message.test(error.message),
      );
      assert.equal(http.requests.length, 0);
    });
  }

  test('the API\'s 422 comes back as an ApiError with its message', async () => {
    http.queueJson(422, { message: 'Invalid loan product.' });

    await assert.rejects(
      client.applyForLoan(validApplication()),
      (error) => error.constructor === ApiError && error.statusCode === 422 && error.message === 'Invalid loan product.',
    );
  });
});

describe('error mapping', () => {
  let http;
  let client;

  beforeEach(() => {
    http = new FakeHttpClient();
    client = new Client({ baseUrl: BASE, token: TOKEN, httpClient: http });
  });

  test('401 is an AuthenticationError', async () => {
    http.queueFixture('error', 401);

    await assert.rejects(
      client.me(),
      (error) => error instanceof AuthenticationError && error.message === 'Unauthenticated.' && error.body.message === 'Unauthenticated.',
    );
  });

  test('429 is a RateLimitError carrying Retry-After', async () => {
    http.queueJson(429, { message: 'Too Many Attempts.' }, { 'retry-after': '37' });

    await assert.rejects(
      client.loans(),
      (error) => error instanceof RateLimitError && error.statusCode === 429 && error.retryAfter === 37,
    );
  });

  test('429 without a usable Retry-After has retryAfter null', async () => {
    http.queueJson(429, { message: 'Too Many Attempts.' }, { 'retry-after': 'soon' });

    await assert.rejects(client.loans(), (error) => error instanceof RateLimitError && error.retryAfter === null);
  });

  test('403 and 404 are plain ApiErrors with the API message', async () => {
    http.queueJson(403, { message: 'This account is not allowed to log in.' });
    http.queueJson(404, { message: 'Loan not found.' });

    await assert.rejects(client.me(), (e) => e.constructor === ApiError && e.statusCode === 403 && e.message === 'This account is not allowed to log in.');
    await assert.rejects(client.loan(1), (e) => e.constructor === ApiError && e.statusCode === 404 && e.message === 'Loan not found.');
  });

  test('a non-JSON error body falls back to a generic message', async () => {
    http.queueResponse(500, '<html>Server Error</html>');

    await assert.rejects(
      client.me(),
      (error) => error instanceof ApiError && error.statusCode === 500 && error.message === 'Zung API returned HTTP 500.' && Object.keys(error.body).length === 0,
    );
  });

  test('a redirect is not followed and is reported', async () => {
    http.queueResponse(302, '', { location: 'https://elsewhere.test/login' });

    await assert.rejects(client.me(), (error) => error instanceof ApiError && error.statusCode === 302);
  });

  for (const [label, body] of [['invalid JSON', '{nope'], ['a JSON array', '[]'], ['an empty body', ''], ['a JSON string', '"ok"']]) {
    test(`a 200 with ${label} is an ApiError`, async () => {
      http.queueResponse(200, body);

      await assert.rejects(client.dashboard(), (error) => error instanceof ApiError && /not a JSON object/.test(error.message));
    });
  }

  test('transport failures propagate as ConnectionError', async () => {
    http.queueError(new ConnectionError('Could not reach Zung: ECONNREFUSED'));

    await assert.rejects(client.me(), ConnectionError);
  });

  test('every library error is a ZungError', async () => {
    http.queueJson(401, { message: 'Unauthenticated.' });

    await assert.rejects(client.me(), ZungError);
    await assert.rejects(client.loan(0), ZungError);
  });

  test('error messages and bodies never contain the token', async () => {
    http.queueJson(401, { message: 'Unauthenticated.' });

    await assert.rejects(client.me(), (error) => !JSON.stringify({ m: error.message, b: error.body, s: error.stack }).includes(TOKEN));
  });
});

test('fixture helper reads the shared fixtures', () => {
  assert.equal(JSON.parse(fixture('login')).token, TOKEN);
});
