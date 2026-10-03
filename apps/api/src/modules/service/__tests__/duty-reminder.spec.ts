import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceService } from '../service.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';

/**
 * The morning reminder (SRV-04).
 *
 * Charley took the watering, saw it confirmed, and heard nothing on the day.
 * The tests here are about the three ways a reminder goes wrong: it arrives on
 * the wrong day, it arrives twice, or it is marked sent when it never left.
 */
describe('ServiceService.remindDue', () => {
  const claim = (over: Record<string, unknown> = {}) => ({
    id: 'claim-1',
    userId: 'u1',
    occursAt: new Date('2026-10-03T13:00:00.000Z'), // 9am New York
    status: 'CONFIRMED',
    duty: {
      title: 'Water the plants',
      description: 'The big fig needs a full can.',
      orgId: 'org-1',
      estimatedMinutes: 20,
    },
    user: { email: 'derek@example.com', name: 'Derek Matt' },
    ...over,
  });

  const build = async (over: { claims?: unknown[]; delivered?: boolean } = {}) => {
    const prisma = {
      dutyClaim: {
        findMany: jest.fn().mockResolvedValue(over.claims ?? [claim()]),
        update: jest.fn().mockResolvedValue({}),
      },
      organization: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'org-1', name: 'MaybeItsFate', slug: 'maybeitsfate', timezone: 'America/New_York' },
        ]),
      },
    };
    const email = { sendRaw: jest.fn().mockResolvedValue(over.delivered ?? true) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ServiceService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: email },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
      ],
    }).compile();

    return { service: moduleRef.get(ServiceService), prisma, email };
  };

  it('emails the member on the morning of their turn', async () => {
    const { service, email } = await build();

    // 8:30am New York, the same day as the 9am turn.
    const result = await service.remindDue(new Date('2026-10-03T12:30:00.000Z'));

    expect(result.sent).toBe(1);
    expect(email.sendRaw).toHaveBeenCalledTimes(1);
    const [to, subject, html] = email.sendRaw.mock.calls[0];
    expect(to).toBe('derek@example.com');
    expect(subject).toContain('Water the plants');
    expect(html).toContain('https://maybeos.org/member/maybeitsfate/service');
  });

  it('says nothing before the morning hour, so a reminder cannot wake somebody', async () => {
    const { service, email } = await build();

    // 5am New York. The turn is today, but this is not a reminder, it is an
    // alarm clock.
    const result = await service.remindDue(new Date('2026-10-03T09:00:00.000Z'));

    expect(result.sent).toBe(0);
    expect(email.sendRaw).not.toHaveBeenCalled();
  });

  it('judges "today" in the co-op\'s timezone, not the server\'s', async () => {
    const { service, email } = await build();

    // 9pm New York on the 2nd — already the 3rd in UTC, which is what a naive
    // date comparison would use, and the member would be told the night before.
    const result = await service.remindDue(new Date('2026-10-03T01:00:00.000Z'));

    expect(result.sent).toBe(0);
    expect(email.sendRaw).not.toHaveBeenCalled();
  });

  it('marks the claim before sending, so a swallowed failure cannot send twice', async () => {
    const { service, prisma, email } = await build();

    const order: string[] = [];
    prisma.dutyClaim.update.mockImplementation(async () => {
      order.push('marked');
      return {};
    });
    email.sendRaw.mockImplementation(async () => {
      order.push('sent');
      return true;
    });

    await service.remindDue(new Date('2026-10-03T12:30:00.000Z'));

    expect(order).toEqual(['marked', 'sent']);
  });

  it('takes the mark back when the provider rejects it, so it retries', async () => {
    const { service, prisma } = await build({ delivered: false });

    const result = await service.remindDue(new Date('2026-10-03T12:30:00.000Z'));

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    expect(prisma.dutyClaim.update).toHaveBeenLastCalledWith({
      where: { id: 'claim-1' },
      data: { remindedAt: null },
    });
  });

  it('asks only for turns nobody has been reminded about', async () => {
    const { service, prisma } = await build();

    await service.remindDue(new Date('2026-10-03T12:30:00.000Z'));

    expect(prisma.dutyClaim.findMany.mock.calls[0][0].where.remindedAt).toBeNull();
  });

  it('leaves a released turn alone — it is not theirs any more', async () => {
    const { service, prisma } = await build();

    await service.remindDue(new Date('2026-10-03T12:30:00.000Z'));

    const { status } = prisma.dutyClaim.findMany.mock.calls[0][0].where;
    expect(status.in).not.toContain('RELEASED');
    expect(status.in).not.toContain('DONE');
  });

  it('keeps going when one member\'s email throws', async () => {
    const { service, prisma, email } = await build({
      claims: [claim(), claim({ id: 'claim-2', user: { email: 'b@example.com', name: 'Bea' } })],
    });
    email.sendRaw.mockRejectedValueOnce(new Error('Postmark said no'));

    const result = await service.remindDue(new Date('2026-10-03T12:30:00.000Z'));

    expect(result.failed).toBe(1);
    expect(result.sent).toBe(1);
    expect(prisma.dutyClaim.update).toHaveBeenCalledTimes(2);
  });

  it('does not put the description\'s HTML into the email as markup', async () => {
    const { service, email } = await build({
      claims: [claim({ duty: { ...claim().duty, description: 'Use <b>the</b> big can' } })],
    });

    await service.remindDue(new Date('2026-10-03T12:30:00.000Z'));

    const html = email.sendRaw.mock.calls[0][2];
    expect(html).toContain('&lt;b&gt;');
  });
});
