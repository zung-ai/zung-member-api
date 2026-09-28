<?php

declare(strict_types=1);

namespace Zung\Tests;

use PHPUnit\Framework\TestCase;
use Zung\Exception\ConnectionException;
use Zung\Http\CurlHttpClient;

final class CurlHttpClientTest extends TestCase
{
    public function testUnreachableHostIsConnectionException(): void
    {
        // Port 9 (discard) on localhost is closed on CI runners and dev machines alike.
        $this->expectException(ConnectionException::class);
        $this->expectExceptionMessage('Could not reach Zung');

        (new CurlHttpClient(timeout: 5, connectTimeout: 5))->request('GET', 'http://127.0.0.1:9/', []);
    }
}
