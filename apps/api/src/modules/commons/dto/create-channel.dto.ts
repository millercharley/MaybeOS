import { IsString, IsOptional, IsBoolean, IsUUID, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One emoji, and nothing that is really a word (CMN-11).
 *
 * A channel emoji is a visual marker beside the name, so "General" typed into
 * the emoji box is a mistake worth refusing rather than storing. The rule
 * wants at least one pictograph or a flag, allows the joiners and modifiers
 * that make up a single glyph — skin tones, variation selectors, the
 * zero-width joiner in 👨‍👩‍👧‍👦 — and caps the length, because a "single emoji"
 * can legitimately be several code points and illegitimately be a sentence.
 */
export const EMOJI_PATTERN =
  /^(?=.*(\p{Extended_Pictographic}|\p{Regional_Indicator}))[^\w\s]{1,24}$/u;

export const EMOJI_MESSAGE = 'Pick a single emoji for the channel.';

export class CreateChannelDto {
  @ApiProperty({ description: 'Channel name' })
  @IsString()
  @MaxLength(60)
  name: string;

  @ApiPropertyOptional({ description: 'Channel description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Whether the channel is publicly visible', default: true })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional({ description: 'A single emoji shown before the name' })
  @IsOptional()
  @Matches(EMOJI_PATTERN, { message: EMOJI_MESSAGE })
  emoji?: string;

  @ApiPropertyOptional({ description: 'The section to file this channel under' })
  @IsOptional()
  @IsUUID()
  sectionId?: string;
}
