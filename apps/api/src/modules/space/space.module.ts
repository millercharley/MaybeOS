import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { EventsModule } from '../events/events.module';
import { SpaceService } from './space.service';
import { SpaceController } from './space.controller';

@Module({
  imports: [EmailModule, EventsModule],
  controllers: [SpaceController],
  providers: [SpaceService],
  exports: [SpaceService],
})
export class SpaceModule {}
