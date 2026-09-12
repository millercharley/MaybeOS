import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  ArrayMaxSize,
  ValidateIf,
  IsUUID,
  Matches,
} from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { EMOJI_PATTERN, EMOJI_MESSAGE } from './create-channel.dto';

export class UpdateChannelDto {
  @ApiPropertyOptional({ description: 'Channel name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'What the channel is for. Null clears it.' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({ description: 'Whether the channel is publicly visible' })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional({ description: 'A single emoji shown before the name. Null clears it.' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @Matches(EMOJI_PATTERN, { message: EMOJI_MESSAGE })
  emoji?: string | null;

  @ApiPropertyOptional({ description: 'The section to file this under. Null ungroups it.' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  sectionId?: string | null;
}

export class ReorderChannelsDto {
  @ApiProperty({
    description: 'Every channel id, in the order they should appear.',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  // A co-op with more than this many channels has a different problem, and an
  // unbounded array here is an unbounded transaction.
  @ArrayMaxSize(200)
  channelIds: string[];
}
