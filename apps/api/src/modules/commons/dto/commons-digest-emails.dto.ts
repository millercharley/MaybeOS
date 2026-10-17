import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** Whether this member gets the weekly Commons digest (CMN-20). */
export class CommonsDigestEmailsDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  commonsDigestEmails!: boolean;
}
