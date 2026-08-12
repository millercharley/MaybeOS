import { IsString, IsIn, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { LOGO_MIME_TYPES } from '../../storage/storage.service';

/**
 * A logo arrives as base64 in a JSON body rather than as multipart/form-data.
 *
 * Multipart is the more conventional choice and was rejected on purpose. The
 * API runs as a Netlify Function behind `serverless-http` (D-005/D-010), where
 * a multipart body arrives base64-encoded from the platform and has to be
 * decoded correctly before multer sees it. That path cannot be exercised
 * locally — `nest start` never encodes the body that way — so shipping it
 * would mean shipping a path first executed in production. This codebase's
 * entire defect list is code that was written and never run.
 *
 * A JSON body takes exactly the route every other endpoint already takes and
 * is proven live. The cost is base64's ~33% inflation: a 2 MB image becomes
 * about 2.7 MB, well inside Netlify's 6 MB request limit.
 */
export class UploadLogoDto {
  @ApiProperty({
    description: 'Base64-encoded image bytes. Accepts a bare base64 string or a data: URL.',
    example: 'iVBORw0KGgoAAAANSUhEUgAA...',
  })
  @IsString()
  @Matches(/^(data:image\/[a-z+]+;base64,)?[A-Za-z0-9+/=\s]+$/, {
    message: 'data must be base64, optionally prefixed with a data: URL header',
  })
  data: string;

  @ApiProperty({ enum: LOGO_MIME_TYPES })
  @IsIn([...LOGO_MIME_TYPES], {
    message: `mimeType must be one of: ${LOGO_MIME_TYPES.join(', ')}`,
  })
  mimeType: string;
}
