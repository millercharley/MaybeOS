import { CallHandler, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Observable, of } from 'rxjs';
import { RequiredReadingInterceptor } from '../required-reading.interceptor';

/**
 * The gate (PRD §6.2, §8.8).
 *
 * Two things are proven here. The first is the decision itself — who is let
 * through, who is stopped, and what they are told. The second matters more
 * over time: that the **set of holes in the gate is a reviewed list**, so a
 * hole cannot be added by someone who did not mean to add one.
 */
describe('RequiredReadingInterceptor', () => {
  let prisma: any;
  let gate: RequiredReadingInterceptor;
  let reflector: Reflector;

  const context = (over: Record<string, unknown> = {}): ExecutionContext => {
    const request = {
      method: 'POST',
      params: { orgId: 'org1' },
      user: { userId: 'u1' },
      ...over,
    };
    return {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as unknown as ExecutionContext;
  };

  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);

  /**
   * Drive it the way Nest does: intercept, then let the handler run.
   *
   * Resolves to true when the request was allowed through, so the assertions
   * below read the same as they did when this was a guard.
   */
  const next = { handle: (): Observable<unknown> => of(true) };
  const run = async (ctx: ExecutionContext): Promise<boolean> => {
    await gate.intercept(ctx, next);
    return true;
  };

  beforeEach(() => {
    prisma = {
      belongingSettings: {
        findUnique: jest.fn().mockResolvedValue({
          knowledgeCenterEnabled: true,
          requiredReadingGraceDays: 14,
        }),
      },
      userOrg: {
        findFirst: jest.fn().mockResolvedValue({ id: 'm1', memberSince: daysAgo(2) }),
      },
      knowledgeArticle: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'a1', title: 'House rules', slug: 'house-rules', version: 1, requiredSince: daysAgo(30) },
        ]),
      },
      articleAcknowledgment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    reflector = new Reflector();
    gate = new RequiredReadingInterceptor(reflector, prisma);
  });

  describe('what it never touches', () => {
    it('lets every read through, always', async () => {
      // Reading stays open so people can see what they are joining. A co-op
      // that hid its norms behind agreement to those norms would be asking
      // for a signature on a blank page.
      for (const method of ['GET', 'HEAD', 'OPTIONS']) {
        await expect(run(context({ method }))).resolves.toBe(true);
        expect(prisma.belongingSettings.findUnique).not.toHaveBeenCalled();
      }
    });

    it('lets an unauthenticated write through to its own protection', async () => {
      await expect(run(context({ user: undefined }))).resolves.toBe(true);
    });

    it('lets a write outside any co-op through', async () => {
      // Signing up and signing in cannot be gated by a co-op's articles.
      await expect(run(context({ params: {} }))).resolves.toBe(true);
    });

    it('lets everything through when the tool is off (§8.10)', async () => {
      prisma.belongingSettings.findUnique.mockResolvedValue({
        knowledgeCenterEnabled: false,
        requiredReadingGraceDays: 14,
      });
      await expect(run(context())).resolves.toBe(true);
      // Off means off — and the acknowledgments already recorded are left
      // exactly where they are.
      expect(prisma.knowledgeArticle.findMany).not.toHaveBeenCalled();
    });

    it('lets a co-op with no required articles through', async () => {
      prisma.knowledgeArticle.findMany.mockResolvedValue([]);
      await expect(run(context())).resolves.toBe(true);
    });

    it('lets a non-member through to whatever else would refuse them', async () => {
      prisma.userOrg.findFirst.mockResolvedValue(null);
      await expect(run(context())).resolves.toBe(true);
    });
  });

  describe('what it stops', () => {
    it('blocks a write when an article is outstanding', async () => {
      await expect(run(context())).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('says what to read and links to it, never a generic error (§6.2)', async () => {
      const error = await run(context()).catch((e) => e);
      const body = error.getResponse();

      expect(body.reason).toBe('REQUIRED_READING');
      expect(body.message).toContain('House rules');
      expect(body.articles).toEqual([{ id: 'a1', title: 'House rules', slug: 'house-rules' }]);
    });

    it('blocks every write method, not just POST', async () => {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        await expect(run(context({ method }))).rejects.toBeInstanceOf(ForbiddenException);
      }
    });

    it('names the first outstanding article by the admin’s order', async () => {
      prisma.knowledgeArticle.findMany.mockResolvedValue([
        { id: 'a1', title: 'First', slug: 'first', version: 1, requiredSince: daysAgo(30) },
        { id: 'a2', title: 'Second', slug: 'second', version: 1, requiredSince: daysAgo(30) },
      ]);
      const error = await run(context()).catch((e) => e);
      expect(error.getResponse().message).toContain('First');
      expect(prisma.knowledgeArticle.findMany.mock.calls[0][0].orderBy).toEqual({ position: 'asc' });
    });
  });

  describe('what it lets through once agreed', () => {
    it('passes a member who has agreed to the current version', async () => {
      prisma.articleAcknowledgment.findMany.mockResolvedValue([{ articleId: 'a1', articleVersion: 1 }]);
      await expect(run(context())).resolves.toBe(true);
    });

    it('still blocks after a material edit bumped the version', async () => {
      prisma.knowledgeArticle.findMany.mockResolvedValue([
        { id: 'a1', title: 'House rules', slug: 'r', version: 2, requiredSince: daysAgo(30) },
      ]);
      prisma.articleAcknowledgment.findMany.mockResolvedValue([{ articleId: 'a1', articleVersion: 1 }]);
      await expect(run(context())).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('takes the highest version agreed, so an old record cannot mask a new one', async () => {
      prisma.knowledgeArticle.findMany.mockResolvedValue([
        { id: 'a1', title: 'House rules', slug: 'r', version: 2, requiredSince: daysAgo(30) },
      ]);
      prisma.articleAcknowledgment.findMany.mockResolvedValue([
        { articleId: 'a1', articleVersion: 2 },
        { articleId: 'a1', articleVersion: 1 },
      ]);
      await expect(run(context())).resolves.toBe(true);
    });

    it('passes a long-standing member still inside their grace period', async () => {
      prisma.userOrg.findFirst.mockResolvedValue({ id: 'm1', memberSince: daysAgo(700) });
      prisma.knowledgeArticle.findMany.mockResolvedValue([
        { id: 'a1', title: 'New policy', slug: 'p', version: 1, requiredSince: daysAgo(2) },
      ]);
      await expect(run(context())).resolves.toBe(true);
    });

    it('hands the countdown to the response rather than making controllers ask', async () => {
      prisma.userOrg.findFirst.mockResolvedValue({ id: 'm1', memberSince: daysAgo(700) });
      prisma.knowledgeArticle.findMany.mockResolvedValue([
        { id: 'a1', title: 'New policy', slug: 'p', version: 1, requiredSince: daysAgo(2) },
      ]);
      const ctx = context();
      await run(ctx);
      const request = ctx.switchToHttp().getRequest();
      expect(request.requiredReadingGraceEndsAt).toBeInstanceOf(Date);
    });
  });

  describe('the holes in the gate are a reviewed list', () => {
    // The gate is default-on precisely so that nobody has to remember it.
    // The corresponding risk is the opposite one: a bypass added in passing.
    // This test makes adding one a deliberate act that fails CI until it is
    // written down here, with the reason a reviewer will read.
    const APPROVED = [
      // Agreeing is the way out of the gate; opting out of buddy emails and
      // dismissing a composer chip are not community writes.
      'src/modules/belonging/belonging.controller.ts',
      // Joining, before you can owe anything.
      'src/modules/member/member.controller.ts',
      // Paying, and reaching the portal to stop paying.
      'src/modules/stripe/stripe.controller.ts',
    ];

    const controllersWithBypass = (): string[] => {
      const found: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name);
          if (entry.isDirectory()) walk(path);
          else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
            const source = readFileSync(path, 'utf8');
            if (/@BypassRequiredReading\(/.test(source)) {
              found.push(path.replace(/^.*?(src\/)/, '$1'));
            }
          }
        }
      };
      walk(join(__dirname, '..', '..', '..', 'modules'));
      return found.sort();
    };

    it('only the approved files punch a hole in it', () => {
      expect(controllersWithBypass()).toEqual([...APPROVED].sort());
    });

    it('every bypass states a reason, because an unexplained hole is a bug', () => {
      for (const file of controllersWithBypass()) {
        const source = readFileSync(join(__dirname, '..', '..', '..', '..', file), 'utf8');
        for (const match of source.matchAll(/@BypassRequiredReading\(([\s\S]*?)\)\n/g)) {
          // A reason long enough to be a sentence rather than a shrug.
          expect(match[1].replace(/\s+/g, ' ').trim().length).toBeGreaterThan(40);
        }
      }
    });

    it('is registered globally, not per controller', () => {
      // Opt-in coverage fails silently: somebody adds an endpoint next year,
      // forgets the decorator, and a co-op's rules stop applying to it.
      const appModule = readFileSync(join(__dirname, '..', '..', '..', 'app.module.ts'), 'utf8');
      expect(appModule).toMatch(
        /provide:\s*APP_INTERCEPTOR,\s*\n\s*useClass:\s*RequiredReadingInterceptor/,
      );
    });

    it('runs after authentication, which a global guard would not have', () => {
      // The bug this pins: Nest runs *global* guards before controller-scoped
      // ones, so as an APP_GUARD this executed before JwtAuthGuard had put
      // anything on `request.user`. It saw an unauthenticated request every
      // time and waved every write through — silently, with no error and no
      // log, while a co-op believed its rules were being enforced.
      //
      // Interceptors run after every guard. Registering this as APP_GUARD
      // again would make the whole feature inert, so the registration is
      // asserted rather than trusted.
      const appModule = readFileSync(join(__dirname, '..', '..', '..', 'app.module.ts'), 'utf8');
      expect(appModule).not.toMatch(/useClass:\s*RequiredReadingInterceptor[\s\S]{0,40}APP_GUARD/);
      expect(appModule).not.toMatch(/APP_GUARD,[\s\n]*useClass:\s*RequiredReadingInterceptor/);
    });
  });
});
