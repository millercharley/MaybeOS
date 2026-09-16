import { ForbiddenException } from '@nestjs/common';
import { assertMemberRoom, countsAsMember, memberRoom } from '../member-capacity';
import { FREE_PLAN_MEMBER_LIMIT as LIMIT } from '../../stripe/dues-pricing';

/**
 * The Free plan's member limit (PAY-09): guests not counted, a hard stop.
 * Written against the constant rather than the number, so raising the limit —
 * as Charley did on 2026-09-16 — does not mean editing arithmetic here.
 */
describe('member capacity on the Free plan', () => {
  const db = (plan: string, members: number, slug = 'a-coop') => ({
    organization: { findUnique: jest.fn().mockResolvedValue({ plan, slug }) },
    userOrg: { count: jest.fn().mockResolvedValue(members) },
  });

  it('counts admins, staff and members, and not guests', async () => {
    const d = db('FREE', 40);
    await memberRoom(d as never, 'org-1');
    expect(d.userOrg.count).toHaveBeenCalledWith({
      where: { orgId: 'org-1', role: { in: ['ADMIN', 'STAFF', 'MEMBER'] } },
    });
    expect(countsAsMember('GUEST')).toBe(false);
    expect(countsAsMember('STAFF')).toBe(true);
  });

  it('leaves room up to the limit on Free, and no limit on Plus or Unlimited', async () => {
    expect(await memberRoom(db('FREE', LIMIT - 3) as never, 'o')).toBe(3);
    expect(await memberRoom(db('FREE', LIMIT) as never, 'o')).toBe(0);
    expect(await memberRoom(db('PLUS', 5000) as never, 'o')).toBeNull();
    expect(await memberRoom(db('UNLIMITED', 5000) as never, 'o')).toBeNull();
  });

  it('never limits the organisers’ forum, which is not a customer', async () => {
    expect(await memberRoom(db('FREE', LIMIT + 50, 'community') as never, 'o')).toBeNull();
  });

  it('lets the last member in and stops the one after', async () => {
    await expect(assertMemberRoom(db('FREE', LIMIT - 1) as never, 'o', 1, 'joiner')).resolves.toBeUndefined();
    await expect(assertMemberRoom(db('FREE', LIMIT) as never, 'o', 1, 'joiner')).rejects.toThrow(ForbiddenException);
  });

  it('tells a joiner the community is full, and an organiser how to make room', async () => {
    await expect(assertMemberRoom(db('FREE', LIMIT) as never, 'o', 1, 'joiner')).rejects.toThrow(/full for now/);
    await expect(assertMemberRoom(db('FREE', LIMIT) as never, 'o', 1, 'organiser')).rejects.toThrow(/Upgrade to Plus or Unlimited/);
  });
});
