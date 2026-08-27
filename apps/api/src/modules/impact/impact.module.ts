import { Module } from '@nestjs/common';
import { StripeModule } from '../stripe/stripe.module';
import { PrismaService } from '../../config/prisma.service';
import { ImpactService } from './impact.service';
import { TouchpointService } from './touchpoint.service';
import { GoalsService } from './goals.service';
import { ReportService } from './report.service';
import { ReportPurchaseService } from './report-purchase.service';
import { ComposerService } from './composer.service';
import { ExpenseService } from './expense.service';
import { ImpactController } from './impact.controller';
import { PublicReportController } from './public-report.controller';

@Module({
  // The written report is sold through the one platform Stripe client
  // (IMP-23); the entitlement it grants is read here.
  imports: [StripeModule],
  controllers: [ImpactController, PublicReportController],
  providers: [PrismaService, ImpactService, TouchpointService, ExpenseService, GoalsService, ReportService, ReportPurchaseService, ComposerService],
  exports: [ImpactService, TouchpointService, ExpenseService, ReportPurchaseService, ReportService],
})
export class ImpactModule {}
