import { IsArray, IsString, ArrayMaxSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReorderTiersDto {
  @ApiProperty({
    description: 'Every tier id, in the order they should appear.',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  // A co-op with more than this many tiers has a different problem, and an
  // unbounded array here is an unbounded transaction.
  @ArrayMaxSize(100)
  tierIds: string[];
}
