import { Module } from '@nestjs/common';
import { CalendarService } from './calendar.service';
import { CalendarImportService } from './calendar-import.service';
import { CalendarController } from './calendar.controller';

@Module({
  controllers: [CalendarController],
  providers: [CalendarService, CalendarImportService],
  exports: [CalendarService, CalendarImportService],
})
export class CalendarModule {}
