import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { StorageModule } from '../storage/storage.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

/**
 * MaybeOS's own documentation (PLT-05). Platform-level: no co-op owns it.
 */
@Module({
  imports: [StorageModule],
  controllers: [SupportController],
  providers: [PrismaService, SupportService],
  exports: [SupportService],
})
export class SupportModule {}
