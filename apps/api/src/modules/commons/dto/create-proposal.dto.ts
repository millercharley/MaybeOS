import { IsString, IsOptional, IsInt, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProposalDto {
  @ApiProperty({ description: 'Proposal title' })
  @IsString()
  title: string;

  @ApiProperty({ description: 'Proposal body / description' })
  @IsString()
  body: string;

  @ApiPropertyOptional({ description: 'Minimum number of votes required for quorum' })
  @IsOptional()
  @IsInt()
  quorum?: number;

  @ApiPropertyOptional({ description: 'Date/time when voting closes (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  closesAt?: string;
}
