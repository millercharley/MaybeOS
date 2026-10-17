import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** Whether this member gets announcements an organiser emails (CMN-21). */
export class AnnouncementEmailsDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  announcementEmails!: boolean;
}
