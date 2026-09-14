import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { BODY_LIMIT } from '../social-caption';

export class SocialSettingsDto {
  @ApiPropertyOptional({ description: 'Whether hosts may share public events to Facebook and Instagram' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Whether members may share without being switched on one by one' })
  @IsOptional()
  @IsBoolean()
  membersByDefault?: boolean;
}

export class ChoosePageDto {
  @ApiProperty({ description: 'The Facebook Page id, from the choices offered' })
  @IsString()
  @Matches(/^\d{1,30}$/)
  pageId!: string;
}

export class MemberSocialDto {
  @ApiProperty({ nullable: true, type: Boolean, description: 'True or false decides; null follows the co-op default' })
  @ValidateIf((_, value) => value !== null)
  @IsBoolean()
  allowed!: boolean | null;
}

export class ShareEventDto {
  @ApiProperty({ enum: ['FACEBOOK', 'INSTAGRAM'], isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(2)
  @IsIn(['FACEBOOK', 'INSTAGRAM'], { each: true })
  platforms!: ('FACEBOOK' | 'INSTAGRAM')[];

  @ApiProperty({ description: 'What the host wrote. The credit and RSVP link are added after it.' })
  @IsString()
  @MaxLength(BODY_LIMIT)
  body!: string;

  @ApiPropertyOptional({ description: 'The picture as a base64 JPEG, cropped for Instagram by the browser' })
  @IsOptional()
  @IsString()
  // 5 MB of JPEG is about 6.7 MB of base64.
  @MaxLength(7_000_000)
  image?: string;
}
