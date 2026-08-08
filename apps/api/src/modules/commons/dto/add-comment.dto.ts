import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddCommentDto {
  @ApiProperty({ description: 'Comment body' })
  @IsString()
  body!: string;

  @ApiPropertyOptional({ description: 'Parent comment ID, for threaded replies' })
  @IsOptional()
  @IsString()
  parentId?: string;
}
