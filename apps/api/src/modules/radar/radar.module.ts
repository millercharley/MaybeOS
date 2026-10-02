import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { RadarController } from './radar.controller';
import { RadarService } from './radar.service';

/**
 * Radar (RDR-01). Exported because two other modules reach into it: EventOS
 * records an RSVP against the member's interests, and the scheduler sends
 * the weekly digest.
 */
@Module({
  imports: [EmailModule],
  controllers: [RadarController],
  providers: [RadarService],
  exports: [RadarService],
})
export class RadarModule {}
