import { IsString } from 'class-validator';

/**
 * One emoji, which the service then checks against the allowed set (CMN-17).
 *
 * Validated there rather than here so the list lives in one place — the web
 * app's picker and the API's guard read the same constant.
 */
export class ReactionDto {
  @IsString()
  emoji!: string;
}
