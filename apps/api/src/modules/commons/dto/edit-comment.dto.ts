import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EditCommentDto {
  @ApiProperty({ description: 'The rewritten comment body' })
  @IsString()
  @MinLength(1)
  body!: string;
}
