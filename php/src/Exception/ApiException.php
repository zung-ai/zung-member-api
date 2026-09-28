<?php

declare(strict_types=1);

namespace Zung\Exception;

/**
 * The Zung API answered, but not with a success. Carries the HTTP status
 * and whatever JSON body came back so callers can inspect it.
 *
 * Subclassed for the statuses callers usually handle specially:
 * {@see AuthenticationException} (401) and {@see RateLimitException} (429).
 */
class ApiException extends \RuntimeException implements ZungExceptionInterface
{
    /**
     * @param array<mixed> $body Decoded JSON response body, if there was one.
     */
    public function __construct(
        string $message,
        private readonly int $statusCode = 0,
        private readonly array $body = [],
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, $statusCode, $previous);
    }

    public function getStatusCode(): int
    {
        return $this->statusCode;
    }

    /**
     * @return array<mixed>
     */
    public function getBody(): array
    {
        return $this->body;
    }
}
