import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { CommonsService } from './commons.service';
import { ThreadsService } from './threads.service';
import { CommonsController } from './commons.controller';
import { StorageModule } from '../storage/storage.module';
import { PlatformModule } from '../platform/platform.module';

@Module({
  // Storage to take the files down with the post, Platform for the audit log:
  // removing somebody else's words is a power a co-op should see used (CMN-18).
  imports: [StorageModule, PlatformModule],
  controllers: [CommonsController],
  providers: [PrismaService, CommonsService, ThreadsService],
  exports: [CommonsService, ThreadsService],
})
export class CommonsModule {}
