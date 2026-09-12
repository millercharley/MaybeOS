import { IsString, IsArray, IsUUID, ArrayMaxSize, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** A named group of channels in the sidebar (CMN-11). */
export class SectionDto {
  @ApiProperty({ description: 'What the section is called, e.g. "General"' })
  @IsString()
  @MaxLength(40)
  name: string;
}

export class ReorderSectionsDto {
  @ApiProperty({ description: 'Every section id, in the order they should appear.', type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  // Same ceiling as channels: an unbounded array here is an unbounded
  // transaction, and a co-op with 200 sidebar headings has another problem.
  @ArrayMaxSize(200)
  sectionIds: string[];
}
