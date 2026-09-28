<?php

declare(strict_types=1);

namespace Zung\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Zung\Client;
use Zung\Exception\ApiException;
use Zung\Exception\AuthenticationException;
use Zung\Exception\ConnectionException;
use Zung\Exception\InvalidArgumentException;
use Zung\Exception\RateLimitException;
use Zung\Exception\ZungExceptionInterface;
use Zung\Http\Response;
use Zung\Tests\Support\FakeHttpClient;

final class ClientTest extends TestCase
{
    private const BASE = 'https://acme.test/api/mobile';
    private const TOKEN = '42|Kq3vT0kenValueForTestsOnly0000000000000';

    private FakeHttpClient $http;
    private Client $member;

    protected function setUp(): void
    {
        $this->http = new FakeHttpClient();
        $this->member = new Client(self::TOKEN, self::BASE, $this->http);
    }

    /**
     * @param array<string, mixed> $overrides
     *
     * @return array<string, mixed>
     */
    private static function validApplication(array $overrides = []): array
    {
        return array_merge([
            'loan_product_id' => 3,
            'amount' => 20000,
            'loan_term' => 6,
            'repayment_frequency' => 1,
            'repayment_frequency_type' => 'months',
            'agree_to_terms' => true,
            'notes' => 'School fees',
        ], $overrides);
    }

    // --- construction -----------------------------------------------------

    public function testDefaultsToProduction(): void
    {
        $this->http->queueFixture('me');
        (new Client(self::TOKEN, http: $this->http))->me();

        self::assertSame('https://app.zung.ai/api/mobile', Client::DEFAULT_BASE_URL);
        self::assertSame('https://app.zung.ai/api/mobile/me', $this->http->lastRequest()['url']);
    }

    public function testStripsTrailingSlashesFromBaseUrl(): void
    {
        $this->http->queueFixture('me');
        (new Client(self::TOKEN, self::BASE . '//', $this->http))->me();

        self::assertSame(self::BASE . '/me', $this->http->lastRequest()['url']);
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function invalidBaseUrls(): iterable
    {
        yield 'not a url' => ['not a url'];
        yield 'ftp' => ['ftp://acme.test/api'];
        yield 'empty' => [''];
    }

    #[DataProvider('invalidBaseUrls')]
    public function testRejectsInvalidBaseUrl(string $baseUrl): void
    {
        $this->expectException(InvalidArgumentException::class);
        new Client(null, $baseUrl);
    }

    public function testRejectsEmptyToken(): void
    {
        $this->expectException(InvalidArgumentException::class);
        new Client('   ');
    }

    public function testWithTokenReturnsNewClientAndLeavesOriginalUntouched(): void
    {
        $anonymous = new Client(null, self::BASE, $this->http);
        $member = $anonymous->withToken(self::TOKEN);

        self::assertNotSame($anonymous, $member);
        self::assertFalse($anonymous->hasToken());
        self::assertTrue($member->hasToken());

        $this->http->queueFixture('me');
        $member->me();
        self::assertSame(self::BASE . '/me', $this->http->lastRequest()['url']);
        self::assertSame('Bearer ' . self::TOKEN, $this->http->lastRequest()['headers']['Authorization']);
    }

    public function testTokenIsRedactedFromDumps(): void
    {
        self::assertStringNotContainsString(self::TOKEN, print_r($this->member, true));

        ob_start();
        var_dump($this->member);
        $dump = (string) ob_get_clean();

        self::assertStringNotContainsString(self::TOKEN, $dump);
        self::assertStringContainsString('[redacted]', $dump);
    }

    // --- login ------------------------------------------------------------

    public function testLoginPostsCredentialsAndReturnsSession(): void
    {
        $this->http->queueFixture('login');
        $anonymous = new Client(null, self::BASE, $this->http);

        $result = $anonymous->login('acme', 'jane@example.com', 's3cret"\\/ñ');

        $request = $this->http->lastRequest();
        self::assertSame('POST', $request['method']);
        self::assertSame(self::BASE . '/login', $request['url']);
        self::assertSame('application/json', $request['headers']['Content-Type']);
        self::assertSame('application/json', $request['headers']['Accept']);
        self::assertArrayNotHasKey('Authorization', $request['headers']);
        self::assertSame(
            ['business' => 'acme', 'login' => 'jane@example.com', 'password' => 's3cret"\\/ñ'],
            json_decode((string) $request['body'], true)
        );

        self::assertSame(self::TOKEN, $result['token']);
        self::assertSame('Jane Wanjiru', $result['contact']['name']);
        self::assertSame('KSh', $result['business']['currency_symbol']);
        self::assertFalse($anonymous->hasToken(), 'login() must not change the client it was called on');
    }

    /**
     * @return iterable<string, array{string, string, string}>
     */
    public static function blankCredentials(): iterable
    {
        yield 'business' => ['  ', 'jane', 'pw'];
        yield 'login' => ['acme', '', 'pw'];
        yield 'password' => ['acme', 'jane', ' '];
    }

    #[DataProvider('blankCredentials')]
    public function testLoginRequiresEveryCredential(string $business, string $login, string $password): void
    {
        try {
            (new Client(null, self::BASE, $this->http))->login($business, $login, $password);
            self::fail('Expected InvalidArgumentException.');
        } catch (InvalidArgumentException) {
            self::assertCount(0, $this->http->requests);
        }
    }

    public function testWrongCredentialsRaiseAuthenticationException(): void
    {
        $this->http->queueJson(401, ['message' => 'Invalid credentials.']);

        try {
            (new Client(null, self::BASE, $this->http))->login('acme', 'jane', 'wrong');
            self::fail('Expected AuthenticationException.');
        } catch (AuthenticationException $e) {
            self::assertInstanceOf(ApiException::class, $e);
            self::assertSame(401, $e->getStatusCode());
            self::assertSame('Invalid credentials.', $e->getMessage());
        }
    }

    public function testLoginWithoutTokenInResponseIsApiException(): void
    {
        $this->http->queueJson(200, ['message' => 'odd']);

        $this->expectException(ApiException::class);
        (new Client(null, self::BASE, $this->http))->login('acme', 'jane', 'pw');
    }

    // --- authenticated endpoints -----------------------------------------

    /**
     * @return iterable<string, array{string, list<int>, string, string, string, \Closure(array<mixed>): bool}>
     */
    public static function endpoints(): iterable
    {
        yield 'me' => ['me', [], 'GET', '/me', 'me', fn (array $r) => $r['account_number'] === 'M-000501'];
        yield 'dashboard' => ['dashboard', [], 'GET', '/dashboard', 'dashboard', fn (array $r) => $r['loans']['balance'] === 48000];
        yield 'loans' => ['loans', [], 'GET', '/loans', 'loans', fn (array $r) => count($r) === 1 && $r[0]['status'] === 'active'];
        yield 'loan' => ['loan', [9001], 'GET', '/loans/9001', 'loan', fn (array $r) => count($r['schedule']) === 2 && $r['schedule'][1]['paid_by_date'] === null];
        yield 'loanProducts' => ['loanProducts', [], 'GET', '/loans/products', 'loan-products', fn (array $r) => $r[0]['maximum_principal'] === 500000];
        yield 'loanApplications' => ['loanApplications', [], 'GET', '/loans/applications', 'loan-applications', fn (array $r) => $r[0]['loan_id'] === null];
        yield 'savingsAccounts' => ['savingsAccounts', [], 'GET', '/savings', 'savings', fn (array $r) => $r[0]['current_balance'] === 27000];
        yield 'savingsAccount' => ['savingsAccount', [301], 'GET', '/savings/301', 'savings-account', fn (array $r) => $r['transactions'][0]['type'] === 'Deposit'];
        yield 'wallets' => ['wallets', [], 'GET', '/wallets', 'wallets', fn (array $r) => $r[0]['currency'] === 'KES'];
    }

    /**
     * @param list<int>                    $args
     * @param \Closure(array<mixed>): bool $check
     */
    #[DataProvider('endpoints')]
    public function testEndpointCallsApiAndUnwrapsResponse(
        string $method,
        array $args,
        string $httpMethod,
        string $path,
        string $fixture,
        \Closure $check,
    ): void {
        $this->http->queueFixture($fixture);

        $result = $this->member->{$method}(...$args);

        $request = $this->http->lastRequest();
        self::assertSame($httpMethod, $request['method']);
        self::assertSame(self::BASE . $path, $request['url']);
        self::assertSame('Bearer ' . self::TOKEN, $request['headers']['Authorization']);
        self::assertSame('application/json', $request['headers']['Accept']);
        self::assertMatchesRegularExpression('#^zung-php/\d+\.\d+\.\d+$#', $request['headers']['User-Agent']);
        self::assertNull($request['body']);
        self::assertTrue($check($result), 'Unexpected result: ' . json_encode($result));
    }

    public function testLogoutPostsToLogout(): void
    {
        $this->http->queueJson(200, ['message' => 'Logged out.']);

        self::assertSame(['message' => 'Logged out.'], $this->member->logout());
        self::assertSame('POST', $this->http->lastRequest()['method']);
        self::assertSame(self::BASE . '/logout', $this->http->lastRequest()['url']);
        self::assertSame('{}', $this->http->lastRequest()['body']);
    }

    public function testEveryAuthenticatedCallFailsFastWithoutToken(): void
    {
        $anonymous = new Client(null, self::BASE, $this->http);

        foreach ([
            fn () => $anonymous->me(),
            fn () => $anonymous->logout(),
            fn () => $anonymous->loans(),
            fn () => $anonymous->applyForLoan(self::validApplication()),
        ] as $call) {
            try {
                $call();
                self::fail('Expected InvalidArgumentException.');
            } catch (InvalidArgumentException $e) {
                self::assertStringContainsString('no member token', $e->getMessage());
            }
        }
        self::assertCount(0, $this->http->requests);
    }

    /**
     * @return iterable<string, array{int}>
     */
    public static function invalidIds(): iterable
    {
        yield 'zero' => [0];
        yield 'negative' => [-1];
    }

    #[DataProvider('invalidIds')]
    public function testRejectsInvalidIdsWithoutRequest(int $id): void
    {
        foreach (['loan', 'savingsAccount'] as $method) {
            try {
                $this->member->{$method}($id);
                self::fail('Expected InvalidArgumentException.');
            } catch (InvalidArgumentException) {
            }
        }
        self::assertCount(0, $this->http->requests);
    }

    /**
     * @return iterable<string, array{array<string, mixed>}>
     */
    public static function badEnvelopes(): iterable
    {
        yield 'missing' => [['something_else' => []]];
        yield 'null' => [['loans' => null]];
        yield 'string' => [['loans' => 'none']];
    }

    /**
     * @param array<string, mixed> $body
     */
    #[DataProvider('badEnvelopes')]
    public function testResponseWithBadEnvelopeIsApiException(array $body): void
    {
        $this->http->queueJson(200, $body);

        $this->expectException(ApiException::class);
        $this->expectExceptionMessage('missing "loans"');
        $this->member->loans();
    }

    // --- applyForLoan -----------------------------------------------------

    public function testApplyForLoanMapsParametersOntoApiFields(): void
    {
        $this->http->queueFixture('apply', 201);

        $result = $this->member->applyForLoan(self::validApplication());

        $request = $this->http->lastRequest();
        self::assertSame('POST', $request['method']);
        self::assertSame(self::BASE . '/loans/apply', $request['url']);
        self::assertSame('application/json', $request['headers']['Content-Type']);
        self::assertSame([
            'loan_product_id' => 3,
            'amount' => 20000,
            'loan_term' => 6,
            'repayment_frequency' => 1,
            'repayment_frequency_type' => 'months',
            'agree_to_term_and_conditions' => true,
            'notes' => 'School fees',
        ], json_decode((string) $request['body'], true));
        self::assertSame(['message' => 'Loan application submitted.', 'application_id' => 78], $result);
    }

    public function testApplyForLoanSendsNumericStringAmountAsNumber(): void
    {
        $this->http->queueFixture('apply', 201);
        $this->member->applyForLoan(self::validApplication(['amount' => '15000.50']));

        self::assertStringContainsString('"amount":15000.5', (string) $this->http->lastRequest()['body']);
    }

    public function testApplyForLoanSendsOmittedOrEmptyNotesAsNull(): void
    {
        $this->http->queueFixture('apply', 201)->queueFixture('apply', 201);

        $params = self::validApplication();
        unset($params['notes']);
        $this->member->applyForLoan($params);
        self::assertNull(json_decode((string) $this->http->lastRequest()['body'], true)['notes']);

        $this->member->applyForLoan(self::validApplication(['notes' => '']));
        self::assertNull(json_decode((string) $this->http->lastRequest()['body'], true)['notes']);
    }

    /**
     * @return iterable<string, array{array<string, mixed>, string}>
     */
    public static function invalidApplications(): iterable
    {
        yield 'unknown parameter' => [['loanProductId' => 3], 'Unknown parameter'];
        yield 'missing amount' => [['amount' => null], '"amount"'];
        yield 'non-numeric amount' => [['amount' => 'lots'], '"amount"'];
        yield 'zero amount' => [['amount' => 0], 'greater than zero'];
        yield 'negative amount' => [['amount' => -5], 'greater than zero'];
        yield 'infinite amount' => [['amount' => INF], '"amount"'];
        yield 'overflowing amount string' => [['amount' => '1e400'], '"amount"'];
        yield 'missing product' => [['loan_product_id' => null], '"loan_product_id"'];
        yield 'fractional product' => [['loan_product_id' => 3.5], '"loan_product_id"'];
        yield 'zero term' => [['loan_term' => 0], '"loan_term"'];
        yield 'string term' => [['loan_term' => '6'], '"loan_term"'];
        yield 'zero frequency' => [['repayment_frequency' => 0], '"repayment_frequency"'];
        yield 'unknown frequency type' => [['repayment_frequency_type' => 'fortnights'], '"repayment_frequency_type"'];
        yield 'singular frequency type' => [['repayment_frequency_type' => 'month'], '"repayment_frequency_type"'];
        yield 'no consent' => [['agree_to_terms' => null], '"agree_to_terms"'];
        yield 'truthy but not true consent' => [['agree_to_terms' => 'yes'], '"agree_to_terms"'];
        yield 'non-string notes' => [['notes' => 5], '"notes"'];
    }

    /**
     * @param array<string, mixed> $overrides
     */
    #[DataProvider('invalidApplications')]
    public function testApplyForLoanRejectsInvalidParamsWithoutRequest(array $overrides, string $message): void
    {
        try {
            $this->member->applyForLoan(self::validApplication($overrides));
            self::fail('Expected InvalidArgumentException.');
        } catch (InvalidArgumentException $e) {
            self::assertStringContainsString($message, $e->getMessage());
        }
        self::assertCount(0, $this->http->requests);
    }

    public function testApiValidationErrorComesBackAsApiException(): void
    {
        $this->http->queueJson(422, ['message' => 'Invalid loan product.']);

        try {
            $this->member->applyForLoan(self::validApplication());
            self::fail('Expected ApiException.');
        } catch (ApiException $e) {
            self::assertSame(ApiException::class, $e::class);
            self::assertSame(422, $e->getStatusCode());
            self::assertSame('Invalid loan product.', $e->getMessage());
        }
    }

    // --- error mapping ----------------------------------------------------

    public function test401IsAuthenticationException(): void
    {
        $this->http->queueFixture('error', 401);

        try {
            $this->member->me();
            self::fail('Expected AuthenticationException.');
        } catch (AuthenticationException $e) {
            self::assertSame('Unauthenticated.', $e->getMessage());
            self::assertSame(['message' => 'Unauthenticated.'], $e->getBody());
        }
    }

    public function test429IsRateLimitExceptionCarryingRetryAfter(): void
    {
        $this->http->queueJson(429, ['message' => 'Too Many Attempts.'], ['retry-after' => '37']);

        try {
            $this->member->loans();
            self::fail('Expected RateLimitException.');
        } catch (RateLimitException $e) {
            self::assertSame(429, $e->getStatusCode());
            self::assertSame(37, $e->getRetryAfter());
        }
    }

    public function test429WithoutUsableRetryAfterHasNull(): void
    {
        $this->http->queueJson(429, ['message' => 'Too Many Attempts.'], ['retry-after' => 'soon']);

        try {
            $this->member->loans();
            self::fail('Expected RateLimitException.');
        } catch (RateLimitException $e) {
            self::assertNull($e->getRetryAfter());
        }
    }

    public function test403And404ArePlainApiExceptionsWithApiMessage(): void
    {
        $this->http->queueJson(403, ['message' => 'This account is not allowed to log in.']);
        $this->http->queueJson(404, ['message' => 'Loan not found.']);

        foreach ([[fn () => $this->member->me(), 403, 'This account is not allowed to log in.'], [fn () => $this->member->loan(1), 404, 'Loan not found.']] as [$call, $status, $message]) {
            try {
                $call();
                self::fail('Expected ApiException.');
            } catch (ApiException $e) {
                self::assertSame(ApiException::class, $e::class);
                self::assertSame($status, $e->getStatusCode());
                self::assertSame($message, $e->getMessage());
            }
        }
    }

    public function testNonJsonErrorBodyFallsBackToGenericMessage(): void
    {
        $this->http->queue(new Response(500, '<html>Server Error</html>'));

        try {
            $this->member->me();
            self::fail('Expected ApiException.');
        } catch (ApiException $e) {
            self::assertSame(500, $e->getStatusCode());
            self::assertSame('Zung API returned HTTP 500.', $e->getMessage());
            self::assertSame([], $e->getBody());
        }
    }

    public function testRedirectIsReportedNotFollowed(): void
    {
        $this->http->queue(new Response(302, '', ['location' => 'https://elsewhere.test/login']));

        try {
            $this->member->me();
            self::fail('Expected ApiException.');
        } catch (ApiException $e) {
            self::assertSame(302, $e->getStatusCode());
        }
        self::assertCount(1, $this->http->requests);
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function nonObjectBodies(): iterable
    {
        yield 'invalid JSON' => ['{nope'];
        yield 'a JSON array' => ['[]'];
        yield 'a JSON list' => ['[1,2]'];
        yield 'an empty body' => [''];
        yield 'a JSON string' => ['"ok"'];
    }

    #[DataProvider('nonObjectBodies')]
    public function testSuccessWithNonObjectBodyIsApiException(string $body): void
    {
        $this->http->queue(new Response(200, $body));

        $this->expectException(ApiException::class);
        $this->expectExceptionMessage('not a JSON object');
        $this->member->dashboard();
    }

    public function testEmptyJsonObjectIsAccepted(): void
    {
        $this->http->queue(new Response(200, '{}'));

        self::assertSame([], $this->member->dashboard());
    }

    public function testTransportFailuresPropagateAsConnectionException(): void
    {
        $this->http->queue(new ConnectionException('Could not reach Zung: refused'));

        $this->expectException(ConnectionException::class);
        $this->member->me();
    }

    public function testEveryLibraryExceptionImplementsTheMarkerInterface(): void
    {
        $this->http->queueJson(401, ['message' => 'Unauthenticated.']);

        foreach ([fn () => $this->member->me(), fn () => $this->member->loan(0)] as $call) {
            try {
                $call();
                self::fail('Expected an exception.');
            } catch (ZungExceptionInterface $e) {
                self::assertInstanceOf(ZungExceptionInterface::class, $e);
            }
        }
    }

    public function testErrorsNeverContainTheToken(): void
    {
        $this->http->queueJson(401, ['message' => 'Unauthenticated.']);

        try {
            $this->member->me();
            self::fail('Expected AuthenticationException.');
        } catch (AuthenticationException $e) {
            self::assertStringNotContainsString(self::TOKEN, $e->getMessage() . json_encode($e->getBody()) . $e->getTraceAsString());
        }
    }
}
