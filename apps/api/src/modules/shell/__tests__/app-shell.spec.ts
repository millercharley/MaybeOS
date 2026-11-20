import { readFileSync } from 'fs';
import { join } from 'path';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { stripComments } from '../../../common/testing/source-scan';
import {
  SHELL_SECTIONS,
  settleShell,
  isUnavailable,
  type ShellSection,
} from '../app-shell';
import { ShellService } from '../shell.service';

const read = (...parts: string[]) =>
  readFileSync(join(__dirname, '..', ...parts), 'utf8');

/**
 * The app shell asks once, not four times (OPS-47).
 *
 * OPS-46 left these five on their own card: they are the chrome's, not the
 * dashboard's, and they are paid on every page rather than one. Four of the
 * five are org-scoped and fire together on the same two values, which is four
 * Netlify Function invocations per page per member on Micro compute.
 */
describe('the app shell bundle', () => {
  describe('what it carries', () => {
    it('names the four the chrome actually needs', () => {
      expect([...SHELL_SECTIONS]).toEqual(['unread', 'onboarding', 'links', 'reading']);
    });

    /*
      `auth/profile` is the fifth request and is deliberately absent. It is
      what establishes which co-op the member is in, so it cannot live inside
      a route scoped to one — two is the floor, not five. Pinned so that
      "finish the job" does not later mean folding an unscoped route into a
      scoped bundle and discovering why at runtime.
    */
    it('does not try to carry the session itself', () => {
      expect(SHELL_SECTIONS).not.toContain('profile');
      expect(read('shell.controller.ts')).toMatch(/orgs\/:orgId\/shell/);
    });

    /*
      The dashboard's bundle is ten sections and one page. This is four
      sections and every page. Folding one into the other would make every
      screen pay for the dashboard.
    */
    it('stays separate from the dashboard bundle', () => {
      const service = stripComments(read('shell.service.ts'));
      expect(service).not.toMatch(/member-home|MEMBER_HOME_SECTIONS|HomeService/);
    });
  });

  describe('a section that fails must not blank the chrome', () => {
    const two: ShellSection[] = ['unread', 'links'];

    it('keeps what was answered and nulls what was not', () => {
      const { sections, failed } = settleShell(two, [
        { status: 'fulfilled', value: 'kept' },
        { status: 'rejected', reason: new Error('links are down') },
      ]);

      expect(sections.unread).toBe('kept');
      expect(sections.links).toBeNull();
      expect(failed.map((f) => f.name)).toEqual(['links']);
      expect((failed[0].reason as Error).message).toBe('links are down');
    });

    it('reports nothing when everything answered', () => {
      const { failed } = settleShell(two, [
        { status: 'fulfilled', value: 1 },
        { status: 'fulfilled', value: 2 },
      ]);
      expect(failed).toEqual([]);
    });

    /*
      `onboarding.forMember` returns null for a co-op with the checklist
      switched off, which is most of them. Null is an answer, not a failure.
    */
    it('does not treat a null answer as a failure', () => {
      const { sections, failed } = settleShell(['onboarding'], [
        { status: 'fulfilled', value: null },
      ]);
      expect(sections.onboarding).toBeNull();
      expect(failed).toEqual([]);
    });

    it('refuses a name list and a result list of different lengths', () => {
      expect(() => settleShell(two, [{ status: 'fulfilled', value: 1 }])).toThrow(
        /2 sections but 1 results/,
      );
    });
  });

  describe('a 403 means "not here", not "broken"', () => {
    it.each([
      ['a Forbidden', new ForbiddenException('off'), true],
      ['a NotFound', new NotFoundException('gone'), false],
      ['a plain Error', new Error('boom'), false],
      ['a string', 'boom', false],
      ['null', null, false],
      ['undefined', undefined, false],
      ['a plain object wearing a status', { status: 403 }, false],
    ])('%s', (_label, reason, expected) => {
      expect(isUnavailable(reason)).toBe(expected);
    });
  });

  /**
   * The rule that makes this safe to ship.
   *
   * The unread arithmetic, the checklist's notion of a finished step and the
   * reading gate's grace period are each a rule somebody got wrong once and
   * fixed in one place. A second copy here would be correct the day it was
   * written and wrong within a month, with no way to tell which copy a member
   * was reading. MEM-27 is the card about exactly that happening.
   */
  describe('it composes and owns nothing', () => {
    const service = stripComments(read('shell.service.ts'));

    it('never reaches for the database itself', () => {
      expect(service).not.toMatch(/PrismaService|this\.prisma/);
    });

    it('settles rather than awaits, so one failure cannot blank every page', () => {
      expect(service).toMatch(/Promise\.allSettled\(/);
      expect(service).not.toMatch(/Promise\.all\(/);
    });

    it('takes the role from the JWT rather than looking it up again', () => {
      expect(service).not.toMatch(/findFirst|findUnique|userOrg/);
      expect(stripComments(read('shell.controller.ts'))).toMatch(/user\.orgRoles/);
    });

    it('is guarded exactly as the four routes it composes are', () => {
      const controller = stripComments(read('shell.controller.ts'));
      expect(controller).toMatch(/UseGuards\(JwtAuthGuard, OrgMembershipGuard\)/);
    });
  });

  describe('each section asks the service the question the route asked', () => {
    const calls: Record<string, unknown[]> = {};
    const spy = (name: string, value: unknown) => (...args: unknown[]) => {
      calls[name] = args;
      return Promise.resolve(value);
    };

    const build = () =>
      new ShellService(
        { unreadCounts: spy('unread', { messages: 1, commons: 2 }) } as never,
        { forMember: spy('onboarding', { steps: [] }) } as never,
        { listLinks: spy('links', [{ label: 'Site' }]) } as never,
        { outstandingForUser: spy('reading', { blocking: [] }) } as never,
      );

    it('passes the org and the actor through unchanged', async () => {
      const sections = await build().appShell('org-1', { userId: 'u-1', isStaff: true });

      expect(calls.unread).toEqual(['org-1', 'u-1', { isStaff: true }]);
      expect(calls.onboarding).toEqual(['org-1', 'u-1']);
      expect(calls.links).toEqual(['org-1']);
      expect(calls.reading).toEqual(['org-1', 'u-1']);

      expect(sections.unread).toEqual({ messages: 1, commons: 2 });
      expect(sections.links).toEqual([{ label: 'Site' }]);
    });

    it('answers the other three when one service throws', async () => {
      const service = new ShellService(
        { unreadCounts: () => Promise.reject(new Error('down')) } as never,
        { forMember: () => Promise.resolve(null) } as never,
        { listLinks: () => Promise.resolve([]) } as never,
        { outstandingForUser: () => Promise.resolve({ blocking: [] }) } as never,
      );

      const sections = await service.appShell('org-1', { userId: 'u-1', isStaff: false });

      expect(sections.unread).toBeNull();
      expect(sections.links).toEqual([]);
      expect(sections.reading).toEqual({ blocking: [] });
    });
  });
});
