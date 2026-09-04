import { IsString, IsIn, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AVATAR_MIME_TYPES } from '../../storage/storage.service';

/**
 * A member's own photo, as base64 in a JSON body.
 *
 * Same reasoning as `UploadLogoDto`, and the same reason it is not multipart:
 * the API runs as a Netlify Function behind `serverless-http`, where a
 * multipart body arrives base64-encoded from the platform and cannot be
 * exercised locally. A JSON body takes the route every other endpoint already
 * takes. The cost is base64's ~33% inflation — a 5 MB photo becomes about
 * 6.7 MB, which is over Netlify's 6 MB request limit, so the practical ceiling
 * for an upload through production is nearer 4 MB than 5. The server's own
 * limit stays at 5 MB because that is what the bucket enforces, and a photo
 * refused by the platform fails loudly rather than being silently truncated.
 */
export class UploadAvatarDto {
  @ApiProperty({
    description: 'Base64-encoded image bytes. Accepts a bare base64 string or a data: URL.',
  })
  @IsString()
  @Matches(/^(data:image\/[a-z+]+;base64,)?[A-Za-z0-9+/=\s]+$/, {
    message: 'data must be base64, optionally prefixed with a data: URL header',
  })
  data: string;

  @ApiProperty({ enum: AVATAR_MIME_TYPES })
  @IsIn([...AVATAR_MIME_TYPES], {
    message: `mimeType must be one of: ${AVATAR_MIME_TYPES.join(', ')}`,
  })
  mimeType: string;
}
