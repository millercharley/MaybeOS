import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { PrismaService } from '../config/prisma.service';

/**
 * The whole application resolves.
 *
 * Written after FRM-01 closed a ring: `OrgModule` already imported
 * `PlatformModule`, and putting a shared service in `OrgModule` and importing
 * that back from `PlatformModule` made a cycle. `tsc` was happy, every unit
 * test passed, and the API would not boot — which in a Lambda is *every*
 * endpoint answering 500, not just the new ones.
 *
 * There were already per-module wiring tests for Impact and Belonging. Each
 * of those only proves its own module resolves; a cycle needs two modules to
 * exist, so only compiling the whole graph finds one. This is that test, and
 * it covers every module added from here on without anybody remembering to
 * write another.
 */
describe('AppModule', () => {
  it('compiles the whole dependency graph', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      // Nothing here talks to a database; the point is the graph, not the data.
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), $disconnect: jest.fn(), $on: jest.fn() })
      .compile();

    expect(module).toBeDefined();
    await module.close();
  }, 30_000);
});
