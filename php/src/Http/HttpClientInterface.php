<?php

declare(strict_types=1);

namespace Zung\Http;

use Zung\Exception\ConnectionException;

/**
 * Minimal transport contract. The default implementation is
 * {@see CurlHttpClient}; implement this to route requests through your own
 * HTTP stack (or to fake the network in tests).
 */
interface HttpClientInterface
{
    /**
     * @param array<string, string> $headers
     *
     * @throws ConnectionException When no HTTP response could be obtained.
     */
    public function request(string $method, string $url, array $headers, ?string $body = null): Response;
}
