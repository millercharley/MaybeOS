import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { SpaceService } from './space.service';
import { SpaceController } from './space.controller';

@Module({
  imports: [EmailModule],
  controllers: [SpaceController],
  providers: [SpaceService],
  exports: [SpaceService],
})
export class SpaceModule {}
