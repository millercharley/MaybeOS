import { ForbiddenException } from '@nestjs/common';
import { assertMemberRoom, countsAsMember, memberRoom } from '../member-capacity';

/**
 * The Free plan's member limit (PAY-09, Charley 2026-09-15): up to 100
 * members, guests not counted, a hard stop.
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

  it('leaves room up to 100 on Free, and no limit on Plus or Unlimited', async () => {
    expect(await memberRoom(db('FREE', 97) as never, 'o')).toBe(3);
    expect(await memberRoom(db('FREE', 100) as never, 'o')).toBe(0);
    expect(await memberRoom(db('PLUS', 5000) as never, 'o')).toBeNull();
    expect(await memberRoom(db('UNLIMITED', 5000) as never, 'o')).toBeNull();
  });

  it('never limits the organisers’ forum, which is not a customer', async () => {
    expect(await memberRoom(db('FREE', 900, 'community') as never, 'o')).toBeNull();
  });

  it('lets member 100 in and stops member 101', async () => {
    await expect(assertMemberRoom(db('FREE', 99) as never, 'o', 1, 'joiner')).resolves.toBeUndefined();
    await expect(assertMemberRoom(db('FREE', 100) as never, 'o', 1, 'joiner')).rejects.toThrow(ForbiddenException);
  });

  it('tells a joiner the community is full, and an organiser how to make room', async () => {
    await expect(assertMemberRoom(db('FREE', 100) as never, 'o', 1, 'joiner')).rejects.toThrow(/full for now/);
    await expect(assertMemberRoom(db('FREE', 100) as never, 'o', 1, 'organiser')).rejects.toThrow(/Upgrade to Plus or Unlimited/);
  });
});
