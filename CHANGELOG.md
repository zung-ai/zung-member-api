# Changelog

## 0.1.0

First release.

- `openapi.yaml`: OpenAPI 3.1 description of the Zung Member API
  (`/api/mobile`): login/logout, profile, dashboard, loans with repayment
  schedules, loan products, loan applications, savings accounts with
  transactions, wallets.
- `zung/zung-php` and `zung-node`: clients for every endpoint, with local
  validation of loan applications and typed errors for 401 and 429.
