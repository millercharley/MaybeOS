import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../../config/prisma.module';
import { PrismaService } from '../../../config/prisma.service';
import { BelongingModule } from '../belonging.module';
import { BelongingSettingsService } from '../belonging-settings.service';
import { BuddyService } from '../buddy.service';
import { BuddyLogService } from '../buddy-log.service';
import { KnowledgeService } from '../knowledge.service';

/**
 * The module resolves (BEL-04).
 *
 * MemberModule and SchedulerModule both import this one, and this one imports
 * EmailModule — an edge `tsc` is happy with either way and Nest only fails at
 * boot. A boot failure in a Lambda is every endpoint returning 500, not just
 * the belonging ones.
 */
describe('BelongingModule wiring', () => {
  it('resolves every service with its dependencies attached', async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, BelongingModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(module.get(BelongingSettingsService)).toBeDefined();
    expect(module.get(BuddyService)).toBeDefined();
    expect(module.get(BuddyLogService)).toBeDefined();
    expect(module.get(KnowledgeService)).toBeDefined();
  });
});
