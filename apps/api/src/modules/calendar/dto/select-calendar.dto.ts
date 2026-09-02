import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SelectCalendarDto {
  @ApiProperty({
    description:
      "The Google calendar id this room writes to. Checked against the connected account's own writable calendars before it is stored.",
    example: 'c_9f3…@group.calendar.google.com',
  })
  @IsString()
  @IsNotEmpty()
  calendarId: string;
}
