// Types mirror ../../openapi.yaml. Response objects are returned exactly as
// the API sends them, so their fields stay snake_case.

export const VERSION: string;
export const DEFAULT_BASE_URL: string;
export const REPAYMENT_FREQUENCY_TYPES: readonly RepaymentFrequencyType[];

/** `YYYY-MM-DD`, in the institution's local calendar. */
export type DateString = string;

export type RepaymentFrequencyType = 'days' | 'weeks' | 'months' | 'years';
export type InterestRateType = 'day' | 'week' | 'month' | 'year';

/** Known values are listed; new statuses may be added, so handle unknown strings. */
export type LoanStatus =
  | 'submitted' | 'pending' | 'approved' | 'active' | 'fully_paid' | 'closed'
  | 'rescheduled' | 'written_off' | 'overpaid' | 'withdrawn' | 'rejected'
  | (string & {});

export type SavingsStatus =
  | 'submitted' | 'pending' | 'approved' | 'active' | 'inactive' | 'dormant'
  | 'closed' | 'withdrawn' | 'rejected'
  | (string & {});

export type WalletStatus =
  | 'pending' | 'approved' | 'active' | 'inactive' | 'suspended' | 'closed' | 'rejected'
  | (string & {});

export interface Contact {
  id: number;
  name: string;
  email: string | null;
  mobile: string | null;
  account_number: string | null;
  /** Absolute URL. */
  photo: string | null;
}

export interface Business {
  id: number;
  name: string;
  currency_symbol: string | null;
}

export interface LoginResult {
  /** Bearer token. Grants access until revoked with `logout()`; store it securely. */
  token: string;
  contact: Contact;
  business: Business;
}

export interface Dashboard {
  wallet_balance: number;
  loans: { balance: number; arrears: number; total_disbursed: number; count: number };
  savings: { total_deposit: number; balance: number; count: number };
}

export interface Loan {
  id: number;
  account_number: string | null;
  status: LoanStatus;
  product_name: string | null;
  loan_officer: string | null;
  principal: number;
  applied_amount: number;
  current_balance: number;
  arrears_amount: number;
  /** Percentage per `interest_rate_type` period. */
  interest_rate: number;
  interest_rate_type: InterestRateType;
  loan_term: number;
  repayment_frequency: number;
  repayment_frequency_type: RepaymentFrequencyType;
  disbursed_on_date: DateString | null;
  expected_maturity_date: DateString | null;
  next_payment_due_date: DateString | null;
  next_payment_amount: number | null;
}

export interface RepaymentInstallment {
  due_date: DateString;
  installment: number;
  principal: number;
  interest: number;
  total_due: number;
  /** Null while unpaid. */
  paid_by_date: DateString | null;
}

export interface LoanDetail extends Loan {
  location: string | null;
  schedule: RepaymentInstallment[];
}

export interface LoanProduct {
  id: number;
  name: string;
  description: string | null;
  minimum_principal: number;
  default_principal: number;
  maximum_principal: number;
  minimum_loan_term: number;
  default_loan_term: number;
  maximum_loan_term: number;
  repayment_frequency: number;
  repayment_frequency_type: RepaymentFrequencyType;
  default_interest_rate: number;
  interest_rate_type: InterestRateType;
}

export interface LoanApplication {
  id: number;
  status: 'pending' | 'approved' | 'rejected';
  product_name: string | null;
  amount: number;
  loan_term: number;
  repayment_frequency: number;
  repayment_frequency_type: string | null;
  /** Set once the application has been converted into a loan. */
  loan_id: number | null;
  /** ISO 8601 timestamp. */
  submitted_at: string | null;
}

export interface ApplyForLoanParams {
  loanProductId: number;
  amount: number | string;
  loanTerm: number;
  repaymentFrequency: number;
  repaymentFrequencyType: RepaymentFrequencyType;
  /** The member's explicit consent to the loan terms. */
  agreeToTerms: true;
  notes?: string | null;
}

export interface ApplyForLoanResult {
  message: string;
  application_id: number;
}

export interface SavingsAccount {
  id: number;
  account_number: string | null;
  status: SavingsStatus;
  product_name: string | null;
  location: string | null;
  interest_rate: number;
  total_deposit: number;
  current_balance: number;
}

export interface SavingsTransaction {
  id: number;
  type: string | null;
  credit: number;
  debit: number;
  /** Running balance after this transaction. */
  balance: number;
  date: DateString | null;
}

export interface SavingsAccountDetail extends SavingsAccount {
  transactions: SavingsTransaction[];
}

export interface Wallet {
  id: number;
  status: WalletStatus | null;
  balance: number;
  /** ISO 4217 code. */
  currency: string | null;
  location: string | null;
  description: string | null;
}

export interface HttpResponse {
  status: number;
  body: string;
  /** Header names lower-cased. */
  headers: Record<string, string>;
}

export interface HttpClient {
  request(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: string | null,
  ): Promise<HttpResponse>;
}

export class FetchHttpClient implements HttpClient {
  constructor(options?: { timeoutMs?: number });
  timeoutMs: number;
  request(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: string | null,
  ): Promise<HttpResponse>;
}

export interface ClientOptions {
  /** Defaults to production, `https://app.zung.ai/api/mobile`. */
  baseUrl?: string;
  /** A member token from `login()`. */
  token?: string | null;
  httpClient?: HttpClient;
}

export class Client {
  constructor(options?: ClientOptions);
  readonly hasToken: boolean;
  withToken(token: string): Client;
  login(credentials: { business: string; login: string; password: string }): Promise<LoginResult>;
  logout(): Promise<{ message: string }>;
  me(): Promise<Contact>;
  dashboard(): Promise<Dashboard>;
  loans(): Promise<Loan[]>;
  loan(id: number): Promise<LoanDetail>;
  loanProducts(): Promise<LoanProduct[]>;
  loanApplications(): Promise<LoanApplication[]>;
  applyForLoan(params: ApplyForLoanParams): Promise<ApplyForLoanResult>;
  savingsAccounts(): Promise<SavingsAccount[]>;
  savingsAccount(id: number): Promise<SavingsAccountDetail>;
  wallets(): Promise<Wallet[]>;
}

export class ZungError extends Error {}
export class InvalidArgumentError extends ZungError {}
export class ApiError extends ZungError {
  constructor(message: string, statusCode?: number, body?: Record<string, unknown>);
  statusCode: number;
  body: Record<string, unknown>;
}
export class AuthenticationError extends ApiError {}
export class RateLimitError extends ApiError {
  constructor(message: string, statusCode?: number, body?: Record<string, unknown>, retryAfter?: number | null);
  /** Seconds the API asked you to wait, or null. */
  retryAfter: number | null;
}
export class ConnectionError extends ZungError {}
