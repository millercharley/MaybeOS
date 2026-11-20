import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { CTA_LIMIT } from '../weekly-cta';

export class SocialSettingsDto {
  @ApiPropertyOptional({ description: "Whether MaybeOS may post to the co-op's Facebook Page and Instagram" })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class ChoosePageDto {
  @ApiProperty({ description: 'The Facebook Page id, from the choices offered' })
  @IsString()
  @Matches(/^\d{1,30}$/)
  pageId!: string;
}

/**
 * The co-op's weekly post (SOC-05).
 *
 * Every field optional: the settings card saves one switch at a time, and a
 * PATCH that demanded the whole shape would make turning Instagram off also
 * a statement about the hour.
 */
export class WeeklyPostDto {
  @ApiPropertyOptional({ description: 'Whether MaybeOS posts what\u2019s on, once a week' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 7, description: 'ISO weekday, 1 Monday to 7 Sunday' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  day?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 23, description: "The hour in the co-op's own timezone" })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  hour?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 31, description: 'Days covered, counting the post\u2019s own' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  days?: number;

  /*
    Capped here as well as in the browser and again at the renderer. The
    renderer is the one that cannot be skipped, but a co-op deserves to be
    told at the form rather than find its words quietly cut a week later.
  */
  @ApiPropertyOptional({ maxLength: CTA_LIMIT, description: 'What the co-op wants people to do' })
  @IsOptional()
  @IsString()
  @MaxLength(CTA_LIMIT)
  cta?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  toPage?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  toInstagram?: boolean;
}
