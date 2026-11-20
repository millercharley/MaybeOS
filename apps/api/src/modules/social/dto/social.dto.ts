import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

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
