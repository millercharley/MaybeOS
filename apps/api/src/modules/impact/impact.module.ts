import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { ImpactService } from './impact.service';
import { TouchpointService } from './touchpoint.service';
import { ExpenseService } from './expense.service';
import { ImpactController } from './impact.controller';

@Module({
  controllers: [ImpactController],
  providers: [PrismaService, ImpactService, TouchpointService, ExpenseService],
  exports: [ImpactService, TouchpointService, ExpenseService],
})
export class ImpactModule {}
