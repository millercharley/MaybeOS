import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ImpactModule } from '../impact.module';
import { PrismaModule } from '../../../config/prisma.module';
import { PrismaService } from '../../../config/prisma.service';
import { ReportService } from '../report.service';
import { ReportPurchaseService } from '../report-purchase.service';

/**
 * The module actually resolves (IMP-23).
 *
 * ImpactModule imports StripeModule so the report can be sold through the one
 * platform Stripe client, and StripeService reaches back into the impact
 * module for the price. That edge is one file away from a dependency cycle
 * Nest only reports at boot — `tsc` is happy with it either way — and a boot
 * failure in a Lambda is every endpoint returning 500, not just this one.
 */
describe('ImpactModule wiring', () => {
  it('resolves the report services with the Stripe module attached', async () => {
    const module = await Test.createTestingModule({
      // PrismaModule is @Global in the real app, which is how StripeService
      // gets its client without declaring one.
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, ImpactModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(module.get(ReportService)).toBeDefined();
    expect(module.get(ReportPurchaseService)).toBeDefined();
  });
});
