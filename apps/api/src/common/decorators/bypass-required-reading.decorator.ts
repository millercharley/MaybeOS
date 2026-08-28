import { SetMetadata } from '@nestjs/common';

export const BYPASS_REQUIRED_READING = 'bypassRequiredReading';

/**
 * Let this write through even when the member owes required reading.
 *
 * **The reason is mandatory and is not decoration.** The gate is deliberately
 * a default-on global guard, so every exemption is a hole somebody punched on
 * purpose — and the only way to keep that true is to make punching one
 * require saying why, in a string a reviewer will read.
 *
 * The bar: exempt an endpoint only when gating it would trap a member rather
 * than restrain them. Agreeing to the article. Leaving the co-op. Paying or
 * cancelling. Turning off the emails that brought them here. A member who has
 * not read the house rules should be unable to post; they should never be
 * unable to leave.
 */
export const BypassRequiredReading = (reason: string) =>
  SetMetadata(BYPASS_REQUIRED_READING, reason);
