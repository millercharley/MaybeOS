import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { PlatformService } from './platform.service';
import { PlatformController } from './platform.controller';
import { AuditService } from './audit.service';
import { StorageHealthIndicator } from '../health/storage.health';

@Module({
  controllers: [PlatformController],
  providers: [PrismaService, PlatformService, AuditService, StorageHealthIndicator],
  exports: [AuditService],
})
export class PlatformModule {}
