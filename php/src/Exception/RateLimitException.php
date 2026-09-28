<?php

declare(strict_types=1);

namespace Zung\Exception;

/**
 * HTTP 429: a rate limit was hit.
 */
final class RateLimitException extends ApiException
{
    /**
     * @param array<mixed> $body
     */
    public function __construct(
        string $message,
        int $statusCode = 429,
        array $body = [],
        private readonly ?int $retryAfter = null,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, $statusCode, $body, $previous);
    }

    /**
     * Seconds the API asked you to wait before retrying, or null if it didn't say.
     */
    public function getRetryAfter(): ?int
    {
        return $this->retryAfter;
    }
}
