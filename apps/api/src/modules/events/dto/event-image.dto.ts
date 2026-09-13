import { IsString, IsIn, Matches, IsOptional, IsInt, Min, Max, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** What the `event-images` bucket accepts. Kept in step with it. */
export const EVENT_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/**
 * A picture arrives as base64 in a JSON body, like a logo and for the same
 * reason: multipart has to be decoded differently behind `serverless-http`,
 * and that path cannot be exercised locally. See `upload-logo.dto.ts`.
 *
 * Org-scoped rather than event-scoped on purpose (EVT-22). The picture is
 * chosen while the event is being written, and on the create form there is no
 * event id to hang it on yet — the alternative is creating the event, then
 * uploading, then patching it, and a failure anywhere in that chain leaves a
 * half-made event behind.
 */
export class UploadEventImageDto {
  @ApiProperty({
    description: 'Base64-encoded image bytes. Accepts a bare base64 string or a data: URL.',
  })
  @IsString()
  @Matches(/^(data:image\/[a-z+]+;base64,)?[A-Za-z0-9+/=\s]+$/, {
    message: 'data must be base64, optionally prefixed with a data: URL header',
  })
  data: string;

  @ApiProperty({ enum: EVENT_IMAGE_MIME_TYPES })
  @IsIn([...EVENT_IMAGE_MIME_TYPES], {
    message: `mimeType must be one of: ${EVENT_IMAGE_MIME_TYPES.join(', ')}`,
  })
  mimeType: string;
}

export class UnsplashSearchDto {
  @ApiProperty({ description: 'What to search Unsplash for.' })
  @IsString()
  @MaxLength(100)
  q: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  page?: number;
}

/**
 * Unsplash asks to be told when a photo is used, and names the endpoint to
 * call in the search result itself. The value is echoed back rather than
 * rebuilt here, and the service refuses any host but theirs.
 */
export class UnsplashUsedDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  downloadLocation: string;
}
