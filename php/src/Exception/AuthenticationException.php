<?php

declare(strict_types=1);

namespace Zung\Exception;

/**
 * HTTP 401: wrong login/password on login(), or a missing, invalid or
 * revoked token on anything else. Send the member back to sign in.
 */
final class AuthenticationException extends ApiException
{
}
