import { IsString, IsOptional, IsBoolean, IsUUID, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One emoji, and nothing that is really a word (CMN-11).
 *
 * The rule itself now lives in `common/emoji.ts`, because reactions need the
 * same one (CMN-21) and a validator two features depend on does not belong
 * inside one of them. Re-exported so nothing that imported it from here had
 * to move.
 */
export { EMOJI_PATTERN } from '../../../common/emoji';
import { EMOJI_PATTERN } from '../../../common/emoji';

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
