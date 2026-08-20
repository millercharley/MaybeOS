import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { PlatformService } from './platform.service';
import { PlatformController } from './platform.controller';
import { AuditService } from './audit.service';

@Module({
  controllers: [PlatformController],
  providers: [PrismaService, PlatformService, AuditService],
  exports: [AuditService],
})
export class PlatformModule {}
