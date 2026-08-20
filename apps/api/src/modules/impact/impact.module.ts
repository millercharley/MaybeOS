import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { ImpactService } from './impact.service';
import { TouchpointService } from './touchpoint.service';
import { GoalsService } from './goals.service';
import { ReportService } from './report.service';
import { ExpenseService } from './expense.service';
import { ImpactController } from './impact.controller';
import { PublicReportController } from './public-report.controller';

@Module({
  controllers: [ImpactController, PublicReportController],
  providers: [PrismaService, ImpactService, TouchpointService, ExpenseService, GoalsService, ReportService],
  exports: [ImpactService, TouchpointService, ExpenseService],
})
export class ImpactModule {}
