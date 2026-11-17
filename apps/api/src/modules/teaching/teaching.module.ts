import { Module } from '@nestjs/common';
import { TeachingService } from './teaching.service';
import { TeachingController } from './teaching.controller';
import { EventsModule } from '../events/events.module';
import { EmailModule } from '../email/email.module';
import { CommonsModule } from '../commons/commons.module';

@Module({
  // A workshop's dates are events, created through `EventsService` rather
  // than written here — which is the whole design (TCH-01). `EventsModule`
  // exports it already.
  //
  // Email tells a teacher somebody put their hand up, which is the only way
  // an enquiry reaches them: MaybeOS deliberately publishes neither party's
  // address.
  // CommonsModule for the #Teaching thread a published offering gets (CMN-22).
  imports: [EventsModule, EmailModule, CommonsModule],
  controllers: [TeachingController],
  providers: [TeachingService],
  exports: [TeachingService],
})
export class TeachingModule {}
