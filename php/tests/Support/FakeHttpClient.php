<?php

declare(strict_types=1);

namespace Zung\Tests\Support;

use Zung\Http\HttpClientInterface;
use Zung\Http\Response;

/**
 * Test double: records every request and replays queued responses (or
 * throws a queued exception).
 */
final class FakeHttpClient implements HttpClientInterface
{
    /** @var list<array{method: string, url: string, headers: array<string, string>, body: ?string}> */
    public array $requests = [];

    /** @var list<Response|\Throwable> */
    private array $queue = [];

    /**
     * A response body from the repo-level fixtures/ directory, shared with
     * the Node SDK's tests and validated against openapi.yaml.
     */
    public static function fixture(string $name): string
    {
        $contents = file_get_contents(__DIR__ . '/../../../fixtures/' . $name . '.json');
        if ($contents === false) {
            throw new \LogicException(sprintf('Fixture "%s" not found.', $name));
        }

        return $contents;
    }

    public function queue(Response|\Throwable $next): self
    {
        $this->queue[] = $next;

        return $this;
    }

    public function queueFixture(string $name, int $status = 200): self
    {
        return $this->queue(new Response($status, self::fixture($name)));
    }

    /**
     * @param array<mixed>          $data
     * @param array<string, string> $headers
     */
    public function queueJson(int $status, array $data, array $headers = []): self
    {
        return $this->queue(new Response($status, json_encode($data, JSON_THROW_ON_ERROR), $headers));
    }

    public function request(string $method, string $url, array $headers, ?string $body = null): Response
    {
        $this->requests[] = compact('method', 'url', 'headers', 'body');

        $next = array_shift($this->queue);
        if ($next === null) {
            throw new \LogicException('FakeHttpClient: no response queued.');
        }
        if ($next instanceof \Throwable) {
            throw $next;
        }

        return $next;
    }

    /**
     * @return array{method: string, url: string, headers: array<string, string>, body: ?string}
     */
    public function lastRequest(): array
    {
        return $this->requests[array_key_last($this->requests)];
    }
}
