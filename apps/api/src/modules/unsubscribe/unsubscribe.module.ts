import { Module } from '@nestjs/common';
import { RadarModule } from '../radar/radar.module';
import { RecapModule } from '../recap/recap.module';
import { UnsubscribeController } from './unsubscribe.controller';

/**
 * One route for stopping any email MaybeOS sends (RDR-01, RCP-01).
 *
 * Its own module rather than a controller inside whichever feature sent the
 * email: a member should not have to care which feature it was, and the
 * second feature is where a per-feature unsubscribe starts to rot.
 */
@Module({
  imports: [RadarModule, RecapModule],
  controllers: [UnsubscribeController],
})
export class UnsubscribeModule {}
