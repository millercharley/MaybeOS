import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RoomImageDto {
  @ApiProperty({
    description:
      'The image, base64 encoded. A full `data:` URL is accepted too, since that is what FileReader hands back.',
  })
  @IsString()
  @IsNotEmpty()
  data: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @IsNotEmpty()
  mimeType: string;
}
