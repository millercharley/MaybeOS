import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, IsUUID } from 'class-validator';
import { ATTACHMENT_MIME_TYPES } from '../../storage/storage.service';

export class CreateUploadUrlDto {
  @ApiProperty({ enum: ATTACHMENT_MIME_TYPES })
  // The bucket enforces this too. Checking here as well means a member gets a
  // sentence about what is accepted rather than a storage error.
  @IsIn(ATTACHMENT_MIME_TYPES as unknown as string[])
  mimeType!: string;
}

export class RecordAttachmentDto {
  @ApiProperty({ description: 'The path returned when the upload URL was issued' })
  @IsString()
  @MaxLength(300)
  path!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({ enum: ATTACHMENT_MIME_TYPES })
  @IsIn(ATTACHMENT_MIME_TYPES as unknown as string[])
  mimeType!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  postId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  commentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  eventId?: string;
}
