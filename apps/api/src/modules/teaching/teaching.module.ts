import { Module } from '@nestjs/common';
import { TeachingService } from './teaching.service';
import { TeachingController } from './teaching.controller';
import { EventsModule } from '../events/events.module';
import { EmailModule } from '../email/email.module';

@Module({
  // A workshop's dates are events, created through `EventsService` rather
  // than written here — which is the whole design (TCH-01). `EventsModule`
  // exports it already.
  //
  // Email tells a teacher somebody put their hand up, which is the only way
  // an enquiry reaches them: MaybeOS deliberately publishes neither party's
  // address.
  imports: [EventsModule, EmailModule],
  controllers: [TeachingController],
  providers: [TeachingService],
  exports: [TeachingService],
})
export class TeachingModule {}
