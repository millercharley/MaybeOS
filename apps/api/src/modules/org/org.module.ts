import { Module } from '@nestjs/common';
import { OrgService } from './org.service';
import { DashboardService } from './dashboard.service';
import { PlatformModule } from '../platform/platform.module';
import { OrgController } from './org.controller';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule, PlatformModule],
  controllers: [OrgController],
  providers: [OrgService, DashboardService],
  exports: [OrgService],
})
export class OrgModule {}
