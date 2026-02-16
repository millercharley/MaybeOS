import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { ImpactService } from './impact.service';
import { ImpactController } from './impact.controller';

@Module({
  controllers: [ImpactController],
  providers: [PrismaService, ImpactService],
  exports: [ImpactService],
})
export class ImpactModule {}
