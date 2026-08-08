import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendMessageDto {
  @ApiProperty({ description: 'Message body' })
  @IsString()
  body!: string;
}
