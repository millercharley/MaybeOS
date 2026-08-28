import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateBelongingSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() buddySystemEnabled?: boolean;

  /**
   * Bounded rather than free. An hour is too short to be fair to somebody at
   * work; a fortnight leaves a new member unmatched for a fortnight.
   */
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(2) @Max(336) buddyInviteTimeoutHours?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(3650) buddyAskCooldownDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(3650) buddyServeCooldownDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(20) buddyMaxActivePairings?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() buddyFallbackAdminId?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() knowledgeCenterEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(365) requiredReadingGraceDays?: number;
}

export class UpsertEmailTemplateDto {
  @ApiProperty() @IsString() @MaxLength(200) subject!: string;
  @ApiProperty() @IsString() @MaxLength(5000) body!: string;
}

export class CreateSuggestionDto {
  @ApiProperty() @IsString() @MaxLength(300) body!: string;
}

export class UpdateSuggestionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) body?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) position?: number;
}

export class SetBuddyOptOutDto {
  @ApiProperty() @IsBoolean() optedOut!: boolean;
}

export class ReassignPairingDto {
  @ApiProperty() @IsUUID() buddyMemberId!: string;
}

export class ClosePairingDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class CreateArticleDto {
  @ApiProperty() @IsString() @MaxLength(200) title!: string;
  @ApiProperty() @IsString() @MaxLength(50000) body!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() coverImagePath?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresAcknowledgment?: boolean;
}

export class UpdateArticleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50000) body?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() coverImagePath?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresAcknowledgment?: boolean;

  /**
   * Whether this edit changes what people agreed to.
   *
   * Required when editing a published article that requires agreement, and
   * deliberately has no default — see `KnowledgeService.update`.
   */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() material?: boolean;
}

export class ReorderArticlesDto {
  @ApiProperty({ type: [String] }) @IsArray() @IsUUID('4', { each: true }) orderedIds!: string[];
}

export class ArticleCommentDto {
  @ApiProperty() @IsString() @MaxLength(2000) body!: string;
}

export class BuddyResponseDto {
  @ApiProperty({ enum: ['accept', 'decline'] })
  @IsIn(['accept', 'decline'])
  answer!: 'accept' | 'decline';
}

export class UploadCoverDto {
  /** Base64, or the full data: URL a browser's FileReader hands back. */
  @ApiProperty() @IsString() data!: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsIn(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  mimeType!: string;
}
