import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { ImpactService } from './impact.service';
import { TouchpointService } from './touchpoint.service';
import { ImpactController } from './impact.controller';

@Module({
  controllers: [ImpactController],
  providers: [PrismaService, ImpactService, TouchpointService],
  exports: [ImpactService, TouchpointService],
})
export class ImpactModule {}
