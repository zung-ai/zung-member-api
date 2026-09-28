# Zung Member API

OpenAPI spec plus PHP and Node.js clients for the **Zung Member API**, the API
behind the Zung mobile app.

[Zung](https://zung.ai) is core banking for SACCOs, MFIs and cooperatives. This
API lets you build **member-facing** channels on top of an institution that
runs on Zung: a branded mobile app, a WhatsApp or USSD bot, a member portal.
A member signs in and can then:

- see their profile and a balance summary,
- list their loans and open one to see its full repayment schedule,
- browse the institution's loan products and apply for a loan,
- follow their loan applications,
- list their savings accounts and recent transactions,
- see their wallet balances.

| | |
|---|---|
| Spec | [`openapi.yaml`](openapi.yaml) (OpenAPI 3.1) |
| PHP | [`php/`](php/src): `zung/zung-php`, PHP 8.1+, ext-curl only |
| Node.js | [`node/`](node/src): `zung-node`, Node 18+, zero dependencies, TypeScript types included |
| Base URL | `https://app.zung.ai/api/mobile` |

## What this API is, and is not

A token belongs to **one member** and only ever sees that member's own data.
This is not a back-office API: it cannot list other members, post
transactions, or read the institution's books.

Login works only when:

- the institution has the **client portal** (CRM module) in its Zung subscription, and
- the member has a portal login that is active, allowed to log in, and linked to their client profile.

Both are set up by the institution's staff in Zung.

## Install

```bash
composer require zung/zung-php
```

```bash
npm install zung-node
```

## Quick start

### PHP

```php
use Zung\Client;
use Zung\Exception\AuthenticationException;

$zung = new Client();

// "acme" is the institution's Zung subdomain (acme.zung.ai).
$session = $zung->login('acme', 'jane@example.com', $password);

// Store $session['token'] securely (e.g. encrypted in your session store).
$member = $zung->withToken($session['token']);

$summary = $member->dashboard();
echo $summary['loans']['balance'];

$loans = $member->loans();
foreach ($loans as $loan) {
    echo $loan['account_number'], ': ', $loan['current_balance'], PHP_EOL;
}

$loan = $member->loan($loans[0]['id']);   // includes $loan['schedule']

$products = $member->loanProducts();
$result = $member->applyForLoan([
    'loan_product_id' => $products[0]['id'],
    'amount' => 20000,
    'loan_term' => 6,
    'repayment_frequency' => 1,
    'repayment_frequency_type' => 'months',
    'agree_to_terms' => true,          // only after the member has actually agreed
    'notes' => 'School fees',
]);
echo $result['application_id'];

$member->logout();
```

### Node.js

```js
import { Client, AuthenticationError } from 'zung-node';

const zung = new Client();

const session = await zung.login({ business: 'acme', login: 'jane@example.com', password });
const member = zung.withToken(session.token);

const summary = await member.dashboard();
const loans = await member.loans();
const loan = await member.loan(loans[0].id);   // includes loan.schedule

const products = await member.loanProducts();
const { application_id } = await member.applyForLoan({
  loanProductId: products[0].id,
  amount: 20000,
  loanTerm: 6,
  repaymentFrequency: 1,
  repaymentFrequencyType: 'months',
  agreeToTerms: true,                  // only after the member has actually agreed
  notes: 'School fees',
});

await member.logout();
```

## Methods

Both clients have the same methods. Responses come back exactly as the API
sends them (snake_case fields, see [`openapi.yaml`](openapi.yaml)), with the
one-key envelope removed: `loans()` returns the list, not `{ loans: [...] }`.

| Method | Endpoint | Returns |
|---|---|---|
| `login(business, login, password)` | `POST /login` | `token`, `contact`, `business` |
| `withToken(token)` | | a new client for that member |
| `logout()` | `POST /logout` | revokes the token |
| `me()` | `GET /me` | the member's profile |
| `dashboard()` | `GET /dashboard` | totals across wallets, loans and savings |
| `loans()` | `GET /loans` | up to 50 loans, newest first |
| `loan(id)` | `GET /loans/{id}` | one loan with its full repayment schedule |
| `loanProducts()` | `GET /loans/products` | active products the member can apply for |
| `loanApplications()` | `GET /loans/applications` | up to 50 applications, newest first |
| `applyForLoan(params)` | `POST /loans/apply` | `message`, `application_id` |
| `savingsAccounts()` | `GET /savings` | up to 50 accounts, newest first |
| `savingsAccount(id)` | `GET /savings/{id}` | one account with its 50 latest transactions |
| `wallets()` | `GET /wallets` | up to 50 wallets, newest first |

`applyForLoan()` checks its parameters before sending anything: unknown keys,
non-positive amounts or terms, an unknown `repayment_frequency_type` (`days`,
`weeks`, `months` or `years`), and missing consent are all rejected locally.

## Errors

| | PHP | Node.js |
|---|---|---|
| Any error from this library | `Zung\Exception\ZungExceptionInterface` | `ZungError` |
| Bad input, caught before any request (including calling a member method without a token) | `InvalidArgumentException` | `InvalidArgumentError` |
| 401: wrong password, or missing/invalid/revoked token | `AuthenticationException` | `AuthenticationError` |
| 429: rate limited (`getRetryAfter()` / `retryAfter`, in seconds) | `RateLimitException` | `RateLimitError` |
| Any other non-2xx (403, 404, 422, 5xx...) | `ApiException` | `ApiError` |
| No response at all (DNS, refused, timeout, TLS) | `ConnectionException` | `ConnectionError` |

API errors carry the HTTP status (`getStatusCode()` / `statusCode`) and the
decoded body (`getBody()` / `body`); the message is the API's own `message`.
On `AuthenticationException` / `AuthenticationError` from a member call, send
the member back to sign in.

## Things to know

- **Tokens don't expire.** A token works until `logout()` revokes it, so
  revoke it when the member signs out, and store it like a password.
- **Rate limits are per client IP.** `POST /login` allows 10 requests per
  minute; everything else 60 per minute. A backend that proxies many
  members' traffic from one server shares one IP's allowance, so call the
  API from the member's device where you can, and back off on
  `RateLimitException` / `RateLimitError` using its retry-after value.
- **No pagination.** Lists return the 50 most recent records.
- **Money is a JSON number** in the institution's currency (`business.currency_symbol`
  from login; `currency` on each wallet). Format it for display, don't do
  accounting with floats.
- **Dates** are `YYYY-MM-DD` strings; loan applications' `submitted_at` is a
  full ISO 8601 timestamp.
- **Statuses may grow.** Handle loan, savings and wallet statuses you don't
  recognise.
- **Redirects are never followed**, so a member's token can't be replayed to
  another host.
- Both clients take a custom transport (`HttpClientInterface` in PHP,
  `httpClient` in Node) if you need proxies, retries or logging. Never log
  the `Authorization` header.

## Payments

To take payments (loan repayments, deposits, wallet top-ups) through PayMfi,
see [`paymfi-php`](https://github.com/zung-ai/paymfi-php) and
[`paymfi-node`](https://github.com/zung-ai/paymfi-node).

## Development

```bash
composer update && vendor/bin/phpunit      # PHP
cd node && npm test                        # Node.js
```

Both test suites replay the same response bodies from [`fixtures/`](fixtures),
and CI validates those fixtures against `openapi.yaml`, so the spec and both
clients are held to the same contract:

```bash
npx @redocly/cli lint openapi.yaml
npm install --no-save ajv@8 ajv-formats@3 yaml@2 && node scripts/check-contract.mjs
```

## License

MIT
