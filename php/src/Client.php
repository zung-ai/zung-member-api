<?php

declare(strict_types=1);

namespace Zung;

use Zung\Exception\ApiException;
use Zung\Exception\AuthenticationException;
use Zung\Exception\InvalidArgumentException;
use Zung\Exception\RateLimitException;
use Zung\Http\CurlHttpClient;
use Zung\Http\HttpClientInterface;

/**
 * Client for the Zung Member API.
 *
 * A token belongs to ONE member and only ever sees that member's data.
 * Use a Client without a token to login(), then withToken() to get a client
 * for that member. Clients are immutable; nothing here is global or static.
 *
 * Every method returns the decoded JSON exactly as the API sent it (see
 * openapi.yaml for each shape), minus the single-key envelope where there
 * is one: loans() returns the list, not ['loans' => [...]].
 */
final class Client
{
    public const VERSION = '0.1.0';
    public const DEFAULT_BASE_URL = 'https://app.zung.ai/api/mobile';
    public const REPAYMENT_FREQUENCY_TYPES = ['days', 'weeks', 'months', 'years'];

    private const APPLY_PARAMS = [
        'loan_product_id', 'amount', 'loan_term', 'repayment_frequency',
        'repayment_frequency_type', 'agree_to_terms', 'notes',
    ];

    private readonly string $baseUrl;
    private readonly HttpClientInterface $http;

    /**
     * @param string|null $token A member token from login().
     *
     * @throws InvalidArgumentException When the token is empty or the base URL is invalid.
     */
    public function __construct(
        #[\SensitiveParameter] private readonly ?string $token = null,
        string $baseUrl = self::DEFAULT_BASE_URL,
        ?HttpClientInterface $http = null,
    ) {
        if ($token !== null && trim($token) === '') {
            throw new InvalidArgumentException('"token" must not be empty.');
        }

        $scheme = strtolower((string) parse_url($baseUrl, PHP_URL_SCHEME));
        if (filter_var($baseUrl, FILTER_VALIDATE_URL) === false || !in_array($scheme, ['https', 'http'], true)) {
            throw new InvalidArgumentException(sprintf('"%s" is not a valid base URL.', $baseUrl));
        }

        $this->baseUrl = rtrim($baseUrl, '/');
        $this->http = $http ?? new CurlHttpClient();
    }

    /**
     * A new client acting as the member who owns $token. Same base URL and
     * transport as this one.
     */
    public function withToken(#[\SensitiveParameter] string $token): self
    {
        return new self($token, $this->baseUrl, $this->http);
    }

    public function hasToken(): bool
    {
        return $this->token !== null;
    }

    /**
     * Logs a member in. Does not change this client: pass the returned
     * 'token' to withToken().
     *
     * @param string $business The institution's Zung subdomain ("acme" for acme.zung.ai).
     * @param string $login    The member's portal username or email.
     *
     * @return array{token: string, contact: array<string, mixed>, business: array<string, mixed>}
     *
     * @throws InvalidArgumentException
     * @throws AuthenticationException On wrong credentials.
     * @throws ApiException
     * @throws \Zung\Exception\ConnectionException
     */
    public function login(string $business, string $login, #[\SensitiveParameter] string $password): array
    {
        foreach (['business' => $business, 'login' => $login, 'password' => $password] as $name => $value) {
            if (trim($value) === '') {
                throw new InvalidArgumentException(sprintf('"%s" is required and must be a non-empty string.', $name));
            }
        }

        $data = $this->send('POST', '/login', [
            'business' => $business,
            'login' => $login,
            'password' => $password,
        ], false);

        if (!is_string($data['token'] ?? null) || $data['token'] === '') {
            throw new ApiException('Zung did not return a token.', 200, $data);
        }

        /** @var array{token: string, contact: array<string, mixed>, business: array<string, mixed>} $data */
        return $data;
    }

    /**
     * Revokes this client's token.
     *
     * @return array{message: string}
     */
    public function logout(): array
    {
        /** @var array{message: string} */
        return $this->send('POST', '/logout');
    }

    /**
     * The member's profile.
     *
     * @return array<string, mixed>
     */
    public function me(): array
    {
        return $this->pluck($this->send('GET', '/me'), 'contact');
    }

    /**
     * Balance totals across loans, savings and wallets.
     *
     * @return array<string, mixed>
     */
    public function dashboard(): array
    {
        return $this->send('GET', '/dashboard');
    }

    /**
     * The member's 50 most recent loans, newest first.
     *
     * @return list<array<string, mixed>>
     */
    public function loans(): array
    {
        return $this->pluck($this->send('GET', '/loans'), 'loans');
    }

    /**
     * One loan with its full repayment schedule.
     *
     * @return array<string, mixed>
     */
    public function loan(int $id): array
    {
        return $this->pluck($this->send('GET', '/loans/' . self::requireId($id)), 'loan');
    }

    /**
     * Active loan products the member can apply for.
     *
     * @return list<array<string, mixed>>
     */
    public function loanProducts(): array
    {
        return $this->pluck($this->send('GET', '/loans/products'), 'products');
    }

    /**
     * The member's 50 most recent loan applications, newest first.
     *
     * @return list<array<string, mixed>>
     */
    public function loanApplications(): array
    {
        return $this->pluck($this->send('GET', '/loans/applications'), 'applications');
    }

    /**
     * Submits a loan application for staff review.
     *
     * Parameters:
     *  - loan_product_id          (required) int, an 'id' from loanProducts()
     *  - amount                   (required) number > 0
     *  - loan_term                (required) int > 0
     *  - repayment_frequency      (required) int > 0
     *  - repayment_frequency_type (required) one of self::REPAYMENT_FREQUENCY_TYPES
     *  - agree_to_terms           (required) must be true: the member's explicit consent
     *  - notes                    (optional) string
     *
     * @param array<string, mixed> $params
     *
     * @return array{message: string, application_id: int}
     *
     * @throws InvalidArgumentException On invalid parameters (no request is made).
     * @throws ApiException             When Zung rejects the application.
     * @throws \Zung\Exception\ConnectionException
     */
    public function applyForLoan(array $params): array
    {
        $unknown = array_diff(array_keys($params), self::APPLY_PARAMS);
        if ($unknown !== []) {
            throw new InvalidArgumentException(sprintf(
                'Unknown parameter(s): %s. Allowed: %s.',
                implode(', ', $unknown),
                implode(', ', self::APPLY_PARAMS)
            ));
        }

        $amount = $params['amount'] ?? null;
        if (!is_int($amount) && !is_float($amount) && !(is_string($amount) && is_numeric($amount))) {
            throw new InvalidArgumentException('"amount" is required and must be numeric.');
        }
        $amount = $amount + 0;
        if (!is_finite((float) $amount)) {
            throw new InvalidArgumentException('"amount" is required and must be numeric.');
        }
        if ($amount <= 0) {
            throw new InvalidArgumentException('"amount" must be greater than zero.');
        }

        $type = $params['repayment_frequency_type'] ?? null;
        if (!in_array($type, self::REPAYMENT_FREQUENCY_TYPES, true)) {
            throw new InvalidArgumentException(sprintf(
                '"repayment_frequency_type" must be one of: %s.',
                implode(', ', self::REPAYMENT_FREQUENCY_TYPES)
            ));
        }

        if (($params['agree_to_terms'] ?? null) !== true) {
            throw new InvalidArgumentException(
                '"agree_to_terms" must be true: record the member\'s consent to the loan terms before applying.'
            );
        }

        $notes = $params['notes'] ?? null;
        if ($notes !== null && !is_string($notes)) {
            throw new InvalidArgumentException('"notes" must be a string.');
        }

        /** @var array{message: string, application_id: int} */
        return $this->send('POST', '/loans/apply', [
            'loan_product_id' => self::requirePositiveInt($params, 'loan_product_id'),
            'amount' => $amount,
            'loan_term' => self::requirePositiveInt($params, 'loan_term'),
            'repayment_frequency' => self::requirePositiveInt($params, 'repayment_frequency'),
            'repayment_frequency_type' => $type,
            'agree_to_term_and_conditions' => true,
            'notes' => $notes === '' ? null : $notes,
        ]);
    }

    /**
     * The member's 50 most recent savings accounts, newest first.
     *
     * @return list<array<string, mixed>>
     */
    public function savingsAccounts(): array
    {
        return $this->pluck($this->send('GET', '/savings'), 'savings');
    }

    /**
     * One savings account with its 50 most recent transactions.
     *
     * @return array<string, mixed>
     */
    public function savingsAccount(int $id): array
    {
        return $this->pluck($this->send('GET', '/savings/' . self::requireId($id)), 'savings');
    }

    /**
     * The member's 50 most recent wallets, newest first.
     *
     * @return list<array<string, mixed>>
     */
    public function wallets(): array
    {
        return $this->pluck($this->send('GET', '/wallets'), 'wallets');
    }

    /**
     * Keeps the token out of var_dump()/print_r() output.
     *
     * @return array<string, mixed>
     */
    public function __debugInfo(): array
    {
        return [
            'baseUrl' => $this->baseUrl,
            'token' => $this->token === null ? null : '[redacted]',
        ];
    }

    /**
     * @param array<string, mixed>|null $body
     *
     * @return array<mixed>
     */
    private function send(string $method, string $path, ?array $body = null, bool $authenticated = true): array
    {
        $headers = [
            'Accept' => 'application/json',
            'User-Agent' => 'zung-php/' . self::VERSION,
        ];

        if ($authenticated) {
            if ($this->token === null) {
                throw new InvalidArgumentException(
                    'This client has no member token. Call login(), then withToken($result[\'token\']).'
                );
            }
            $headers['Authorization'] = 'Bearer ' . $this->token;
        }

        $rawBody = null;
        if ($method !== 'GET') {
            try {
                $rawBody = json_encode($body ?? new \stdClass(), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            } catch (\JsonException $e) {
                throw new InvalidArgumentException('Request could not be encoded as JSON: ' . $e->getMessage(), 0, $e);
            }
            $headers['Content-Type'] = 'application/json';
        }

        $response = $this->http->request($method, $this->baseUrl . $path, $headers, $rawBody);

        $decoded = null;
        if ($response->body !== '') {
            $decoded = json_decode($response->body, true);
        }
        // A JSON object decodes to an array; a JSON list ([...]) is not a valid response here.
        $isObject = is_array($decoded) && ($decoded === [] ? str_starts_with(ltrim($response->body), '{') : !array_is_list($decoded));

        if ($response->status < 200 || $response->status >= 300) {
            $message = $isObject && is_string($decoded['message'] ?? null)
                ? $decoded['message']
                : sprintf('Zung API returned HTTP %d.', $response->status);
            $errorBody = $isObject ? $decoded : [];

            if ($response->status === 401) {
                throw new AuthenticationException($message, 401, $errorBody);
            }
            if ($response->status === 429) {
                $retryAfter = trim($response->headers['retry-after'] ?? '');

                throw new RateLimitException($message, 429, $errorBody, ctype_digit($retryAfter) ? (int) $retryAfter : null);
            }

            throw new ApiException($message, $response->status, $errorBody);
        }

        if (!$isObject) {
            throw new ApiException('Zung returned a response that is not a JSON object.', $response->status);
        }

        return $decoded;
    }

    /**
     * @param array<mixed> $data
     *
     * @return array<mixed>
     */
    private function pluck(array $data, string $key): array
    {
        if (!array_key_exists($key, $data) || !is_array($data[$key])) {
            throw new ApiException(sprintf('Zung response is missing "%s".', $key), 200, $data);
        }

        return $data[$key];
    }

    /**
     * @param array<string, mixed> $params
     */
    private static function requirePositiveInt(array $params, string $key): int
    {
        $value = $params[$key] ?? null;

        if (!is_int($value) || $value <= 0) {
            throw new InvalidArgumentException(sprintf('"%s" is required and must be a positive integer.', $key));
        }

        return $value;
    }

    private static function requireId(int $id): int
    {
        if ($id <= 0) {
            throw new InvalidArgumentException('"id" must be a positive integer.');
        }

        return $id;
    }
}
