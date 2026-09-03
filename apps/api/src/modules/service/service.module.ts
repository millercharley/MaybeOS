import { Module } from '@nestjs/common';
import { ServiceController } from './service.controller';
import { ServiceService } from './service.service';
import { HostBriefingService } from './host-briefing.service';
import { EmailModule } from '../email/email.module';

@Module({
  // Host briefings are emails (SRV-03).
  imports: [EmailModule],
  controllers: [ServiceController],
  providers: [ServiceService, HostBriefingService],
  exports: [ServiceService, HostBriefingService],
})
export class ServiceModule {}
