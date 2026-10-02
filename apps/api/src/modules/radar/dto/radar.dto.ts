import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class UpdateRadarSettingsDto {
  @ApiPropertyOptional({ description: 'Whether Radar digests go out at all. Plus and Unlimited only.' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Day of the week the digest goes out, 0 = Sunday.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  digestDay?: number;

  @ApiPropertyOptional({ description: "Hour it goes out, in the co-op's own timezone." })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  digestHour?: number;
}

export class CreateInterestTagDto {
  @ApiProperty()
  @IsString()
  @MaxLength(40)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8)
  emoji?: string;
}

export class UpdateInterestTagDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8)
  emoji?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class InterestAnswerDto {
  @ApiProperty()
  @IsUUID()
  tagId!: string;

  /**
   * Three-valued on the wire as well as in the database: true is yes, false
   * is "stop suggesting this", and null clears the answer back to whatever
   * their RSVPs suggest. A missing field is not an answer.
   */
  @ApiProperty({ nullable: true })
  @IsOptional()
  @IsBoolean()
  declared!: boolean | null;
}

export class SetInterestsDto {
  @ApiProperty({ type: [InterestAnswerDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => InterestAnswerDto)
  answers!: InterestAnswerDto[];
}

export class SetRadarEmailsDto {
  @ApiProperty()
  @IsBoolean()
  radarEmails!: boolean;
}
