<?php

declare(strict_types=1);

namespace Zung\Exception;

/**
 * Marker interface implemented by every exception this library throws, so
 * callers can catch everything from Zung with a single `catch`.
 */
interface ZungExceptionInterface extends \Throwable
{
}
