import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email.service';

/**
 * Asking the provider what it did (MEM-25).
 *
 * These guard one shape mistake that cost a round trip to production: the
 * audit sent both `fromDate` and `fromdate` to cover either spelling, Postmark
 * lowercases parameter names, and the two became one parameter with two
 * values. Every audit came back "Parameter 'fromdate' should be date/time
 * value" — a filter sent twice is not a filter sent safely.
 */
describe('reading the provider’s records', () => {
  let service: EmailService;
  let client: { getOutboundMessages: jest.Mock; getBounces: jest.Mock };

  beforeEach(() => {
    service = new EmailService({
      get: (key: string) => (key === 'POSTMARK_API_TOKEN' ? 'token' : 'noreply@maybeos.org'),
    } as unknown as ConfigService);

    client = {
      getOutboundMessages: jest.fn().mockResolvedValue({ TotalCount: '0', Messages: [] }),
      getBounces: jest.fn().mockResolvedValue({ TotalCount: 0, Bounces: [] }),
    };
    (service as unknown as { client: unknown }).client = client;
  });

  function datelikeKeys(filter: Record<string, unknown>): string[] {
    return Object.keys(filter).filter((key) => /date/i.test(key));
  }

  it('names each end of the window exactly once', async () => {
    await service.outboundMessages({
      fromDate: '2026-10-03',
      toDate: '2026-10-05',
      count: 500,
      offset: 0,
    });

    const filter = client.getOutboundMessages.mock.calls[0][0];

    // Two keys, not four. Postmark folds `fromDate` and `fromdate` together
    // and then cannot parse what it is holding.
    expect(datelikeKeys(filter).sort()).toEqual(['fromDate', 'toDate']);
    expect(filter.fromDate).toBe('2026-10-03');
  });

  it('names the bounce window exactly once too', async () => {
    await service.bounces({
      fromDate: '2026-10-03',
      toDate: '2026-10-07',
      count: 500,
      offset: 0,
    });

    const filter = client.getBounces.mock.calls[0][0];
    expect(datelikeKeys(filter).sort()).toEqual(['fromDate', 'toDate']);
  });

  it('reads the Cc as a recipient, which is where an alternate address lands', async () => {
    // MEM-19: the link goes to the primary with the alternate copied, and
    // matching on the primary alone calls a delivered message missing.
    client.getOutboundMessages.mockResolvedValue({
      TotalCount: '1',
      Messages: [
        {
          Recipients: ['primary@example.com', 'alternate@example.com'],
          Subject: 'Your NEW MaybeItsFate account is ready!',
          Tag: 'sign-in-link',
          ReceivedAt: '2026-10-04T16:00:40Z',
        },
      ],
    });

    const page = await service.outboundMessages({
      fromDate: '2026-10-03',
      toDate: '2026-10-05',
      count: 500,
      offset: 0,
    });

    expect(page?.total).toBe(1);
    expect(page?.messages[0].recipients).toHaveLength(2);
  });

  it('says there is nothing to read when no provider is configured', async () => {
    const offline = new EmailService({
      get: (key: string) => (key === 'POSTMARK_API_TOKEN' ? undefined : 'noreply@maybeos.org'),
    } as unknown as ConfigService);

    // Null rather than empty: an audit that read "no provider" as "nothing was
    // ever delivered" would offer to re-send to the entire roster.
    expect(await offline.outboundMessages({ fromDate: 'a', toDate: 'b', count: 1, offset: 0 })).toBeNull();
    expect(offline.hasProvider).toBe(false);
  });
});
