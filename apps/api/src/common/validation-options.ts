import type { ValidationPipeOptions } from '@nestjs/common';

/**
 * The API's one ValidationPipe configuration (EVT-21).
 *
 * In a file of its own so a test can run a body through exactly what
 * production runs. A test that copied these three flags would keep passing the
 * day somebody changed one — which is the failure it exists to catch.
 */
export const VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  // Unknown fields reject the whole request rather than being dropped. Strict
  // on purpose, and the reason one undeclared key on the event edit form
  // failed every save.
  forbidNonWhitelisted: true,
  transform: true,
};
