import {
  SIGN_IN_TAG,
  beyondRetention,
  bounceKind,
  indexBounces,
  indexDelivered,
  inconclusive,
  isPermanentRefusal,
  isDeliveryFailure,
  isSignInMessage,
  memberAddresses,
  normalizeEmail,
  postmarkDay,
  scopeFilter,
  tallyLine,
  verdictFor,
  wasSent,
  type AuditMessage,
} from '../sign-in-audit';

const SUBJECT = 'Your MaybeItsFate account is ready';

function message(over: Partial<AuditMessage> = {}): AuditMessage {
  return {
    recipients: ['member@example.com'],
    subject: SUBJECT,
    tag: null,
    receivedAt: '2026-10-04T16:00:40.000Z',
    ...over,
  };
}

describe('matching a sign-in message', () => {
  it('matches on the subject the template produces', () => {
    expect(isSignInMessage(message(), SUBJECT)).toBe(true);
  });

  it('ignores case and stray whitespace, which a template edit introduces', () => {
    expect(isSignInMessage(message({ subject: '  your  MaybeItsFate account is ready ' }), SUBJECT)).toBe(
      true,
    );
  });

  it('matches on the tag whatever the subject says', () => {
    // How every send from now on is identified: a reworded subject must not
    // make a tagged message invisible.
    expect(
      isSignInMessage(message({ subject: 'Completely different', tag: SIGN_IN_TAG }), SUBJECT),
    ).toBe(true);
  });

  it('does not match the co-op’s other mail', () => {
    expect(isSignInMessage(message({ subject: 'Your door code' }), SUBJECT)).toBe(false);
  });
});

describe('indexing what the provider accepted', () => {
  it('credits every recipient, including the copied alternate address', () => {
    // MEM-19: a sign-in link goes to the primary with the alternate Cc'd, and
    // Postmark lists both under Recipients. Reading only the first would call
    // a delivered message missing.
    const delivered = indexDelivered(
      [message({ recipients: ['primary@example.com', 'alternate@example.com'] })],
      SUBJECT,
    );

    expect(delivered.has('primary@example.com')).toBe(true);
    expect(delivered.has('alternate@example.com')).toBe(true);
  });

  it('keeps the earliest acceptance when somebody was written to twice', () => {
    const delivered = indexDelivered(
      [
        message({ receivedAt: '2026-10-06T09:00:00.000Z' }),
        message({ receivedAt: '2026-10-04T16:00:40.000Z' }),
      ],
      SUBJECT,
    );

    expect(delivered.get('member@example.com')?.toISOString()).toBe('2026-10-04T16:00:40.000Z');
  });

  it('skips messages that are not sign-in links', () => {
    const delivered = indexDelivered([message({ subject: 'Tonight at MaybeItsFate' })], SUBJECT);
    expect(delivered.size).toBe(0);
  });

  it('survives a date the provider sent back malformed', () => {
    const delivered = indexDelivered([message({ receivedAt: 'not a date' })], SUBJECT);
    expect(delivered.size).toBe(0);
  });
});

describe('indexing bounces', () => {
  it('keeps the most recent bounce for an address', () => {
    // The opposite of delivery: an address that broke in March and was fixed
    // in April should read from the newest record, not the oldest.
    const bounced = indexBounces([
      { email: 'member@example.com', type: 'HardBounce', bouncedAt: '2026-03-01T00:00:00.000Z' },
      { email: 'member@example.com', type: 'Transient', bouncedAt: '2026-10-04T16:05:00.000Z' },
    ]);

    expect(bounced.get('member@example.com')?.type).toBe('Transient');
  });

  it('normalises the address the provider reports', () => {
    const bounced = indexBounces([
      { email: ' Member@Example.com ', type: 'HardBounce', bouncedAt: '2026-10-04T16:05:00.000Z' },
    ]);

    expect(bounced.has('member@example.com')).toBe(true);
  });
});

describe('what Postmark files as a bounce but is not one', () => {
  /*
    Found on the first audit of the real roster.

    One of MaybeItsFate's 433 came back as "Auto Responder" — an out-of-office
    reply. MaybeOS recorded a bounced address, showed the admin a member whose
    email needed fixing, and left them out of every re-send, on the strength of
    a message proving their address works.
  */
  it('does not treat an out-of-office reply as a failure', () => {
    expect(isDeliveryFailure('AutoResponder')).toBe(false);

    const bounced = indexBounces([
      { email: 'away@example.com', type: 'AutoResponder', bouncedAt: '2026-10-04T16:05:00.000Z' },
    ]);
    expect(bounced.size).toBe(0);
  });

  it('does not treat a subscribe or an address-change notice as a failure', () => {
    expect(isDeliveryFailure('Subscribe')).toBe(false);
    expect(isDeliveryFailure('AddressChange')).toBe(false);
  });

  it('still treats the real failures as failures', () => {
    for (const type of ['HardBounce', 'SoftBounce', 'DnsError', 'Blocked', 'SpamComplaint']) {
      expect(isDeliveryFailure(type)).toBe(true);
    }

    const bounced = indexBounces([
      { email: 'gone@example.com', type: 'HardBounce', bouncedAt: '2026-10-04T16:05:00.000Z' },
    ]);
    expect(bounced.size).toBe(1);
  });
});

describe('a message the provider has not actually sent', () => {
  it('does not count a queued message as reached', () => {
    // It is in the outbound list and it has gone nowhere — the same mistake as
    // trusting our own mark, one layer further out.
    expect(wasSent(message({ status: 'Queued' }))).toBe(false);

    const delivered = indexDelivered([message({ status: 'Queued' })], SUBJECT);
    expect(delivered.size).toBe(0);
  });

  it('counts the ones it has', () => {
    expect(wasSent(message({ status: 'Sent' }))).toBe(true);
    expect(wasSent(message({ status: 'Processed' }))).toBe(true);
  });

  it('treats a missing status as sent, which is what older records have', () => {
    expect(wasSent(message({ status: null }))).toBe(true);
  });
});

describe('the verdict for one member', () => {
  const delivered = new Map([['member@example.com', new Date('2026-10-04T16:00:40.000Z')]]);

  it('is delivered when the provider accepted it', () => {
    expect(verdictFor(['member@example.com'], delivered, new Map()).outcome).toBe('delivered');
  });

  it('is missing when the provider has never heard of it', () => {
    // The whole reason this audit exists: 335 members looked exactly like this
    // while every screen in MaybeOS called them sent.
    expect(verdictFor(['nobody@example.com'], delivered, new Map()).outcome).toBe('missing');
  });

  it('is bounced even though the provider accepted the message', () => {
    // Acceptance and arrival are different questions. A bounced message is in
    // the outbound list too, so delivery alone would call this one reached.
    const bounced = indexBounces([
      { email: 'member@example.com', type: 'HardBounce', bouncedAt: '2026-10-04T16:05:00.000Z' },
    ]);

    const verdict = verdictFor(['member@example.com'], delivered, bounced);
    expect(verdict.outcome).toBe('bounced');
    expect(verdict.kind).toContain('does not exist');
  });

  it('finds a delivery at the member’s alternate address', () => {
    const verdict = verdictFor(['unused@example.com', 'member@example.com'], delivered, new Map());
    expect(verdict.outcome).toBe('delivered');
  });
});

describe('refusing to guess', () => {
  it('is inconclusive when the provider has messages but none were recognised', () => {
    // The signature of broken matching — a reworded subject. Calling everybody
    // unsent here would send a second copy to everybody who already has one.
    expect(inconclusive({ messagesInWindow: 440, signInMessagesMatched: 0 })).toBe(true);
  });

  it('is conclusive when the provider has no messages at all', () => {
    // Which is exactly what a quota rejection looks like, and is a real answer.
    expect(inconclusive({ messagesInWindow: 0, signInMessagesMatched: 0 })).toBe(false);
  });

  it('is conclusive once anything matched', () => {
    expect(inconclusive({ messagesInWindow: 440, signInMessagesMatched: 100 })).toBe(false);
  });

  it('notices a send old enough for the provider to have forgotten it', () => {
    const sent = new Date('2026-08-01T00:00:00.000Z');
    expect(beyondRetention(sent, new Date('2026-10-07T00:00:00.000Z'))).toBe(true);
    expect(beyondRetention(sent, new Date('2026-08-20T00:00:00.000Z'))).toBe(false);
  });
});

describe('who a re-send reaches', () => {
  it('leaves the original send exactly as it was', () => {
    // The default, so a client that knows nothing about scopes behaves as before.
    expect(scopeFilter('waiting')).toMatchObject({ signInSentAt: null });
  });

  it('requires an audit before calling anybody undelivered', () => {
    // Without this, every member sent a link before the audit existed reads as
    // undelivered, because nothing has looked at them yet.
    expect(scopeFilter('undelivered')).toMatchObject({
      signInAuditedAt: { not: null },
      signInDeliveredAt: null,
    });
  });

  it('judges a stalled member by whether they actually signed in', () => {
    expect(scopeFilter('not-signed-in')).toMatchObject({
      signInDeliveredAt: { not: null },
      user: { lastLoginAt: null, passwordHash: null },
    });
  });

  it('excludes bounced addresses from every scope', () => {
    // Re-sending to one cannot work, and spends quota the reachable members need.
    for (const scope of ['waiting', 'undelivered', 'not-signed-in'] as const) {
      expect(scopeFilter(scope)).toMatchObject({ signInBouncedAt: null });
    }
  });

  it('never writes to somebody who already has a password', () => {
    for (const scope of ['waiting', 'undelivered', 'not-signed-in'] as const) {
      expect(scopeFilter(scope)).toMatchObject({ user: { passwordHash: null } });
    }
  });
});

describe('wording the admin reads', () => {
  it('names the bounce types that need opposite responses', () => {
    expect(bounceKind('HardBounce')).toContain('does not exist');
    expect(bounceKind('SpamComplaint')).toContain('do not write again');
  });

  it('spaces out a type it has never seen rather than printing camel case', () => {
    expect(bounceKind('SomeNewThing')).toBe('Some New Thing');
  });

  it('knows which bounces are a person refusing rather than an address failing', () => {
    expect(isPermanentRefusal('SpamComplaint')).toBe(true);
    expect(isPermanentRefusal('Unsubscribe')).toBe(true);
    expect(isPermanentRefusal('HardBounce')).toBe(false);
  });

  it('accounts for every marked member in the headline', () => {
    const line = tallyLine({
      marked: 435,
      delivered: 100,
      bounced: 0,
      missing: 335,
      stalled: 91,
      neverSent: 0,
    });

    expect(line).toContain('435 marked as sent');
    expect(line).toContain('100 reached');
    expect(line).toContain('335 never actually sent');
  });

  it('says nothing has gone out rather than reporting zeroes', () => {
    expect(
      tallyLine({ marked: 0, delivered: 0, bounced: 0, missing: 0, stalled: 0, neverSent: 435 }),
    ).toBe('No sign-in links have been sent yet.');
  });
});

describe('addresses and dates', () => {
  it('collapses one member’s two addresses, dropping the blank and the duplicate', () => {
    expect(memberAddresses({ email: 'A@Example.com', altEmail: 'a@example.com' })).toEqual([
      'a@example.com',
    ]);
    expect(memberAddresses({ email: 'a@example.com', altEmail: null })).toEqual(['a@example.com']);
    expect(memberAddresses({ email: null, altEmail: null })).toEqual([]);
  });

  it('normalises an address the way both sides of the comparison need', () => {
    expect(normalizeEmail('  Member@Example.COM ')).toBe('member@example.com');
    expect(normalizeEmail(null)).toBe('');
  });

  it('formats a provider window as whole UTC days', () => {
    // Postmark's message search filters by date, not by timestamp.
    expect(postmarkDay(new Date('2026-10-04T16:00:40.000Z'))).toBe('2026-10-04');
    expect(postmarkDay(new Date('2026-10-04T16:00:40.000Z'), -1)).toBe('2026-10-03');
    expect(postmarkDay(new Date('2026-10-04T16:00:40.000Z'), 1)).toBe('2026-10-05');
  });
});
