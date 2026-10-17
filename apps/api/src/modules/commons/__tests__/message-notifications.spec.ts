import {
  awaitingNotice,
  preview,
  PREVIEW_LIMIT,
  recipientsFor,
  wantsEmail,
  type Participant,
} from '../message-notifications';

/**
 * Who hears that somebody wrote to them (CMN-19).
 *
 * The rule is "a direct message emails immediately". The whole risk is in
 * what stops that meaning "on every line": two members talking inside
 * MaybeOS emailing each other once per message is how a roster learns to
 * filter the product into a folder it never opens.
 */
const t = (iso: string) => new Date(iso);

function participant(over: Partial<Participant> = {}): Participant {
  return {
    userId: 'u1',
    lastReadAt: null,
    notifiedAt: null,
    emailOptIn: null,
    messageEmails: true,
    email: 'ruth@outlook.com',
    altEmail: null,
    ...over,
  };
}

describe('told once, and not again until they have looked', () => {
  it('tells somebody who has never been told', () => {
    expect(awaitingNotice({ lastReadAt: null, notifiedAt: null })).toBe(true);
  });

  it('tells somebody who read the thread before the last time we wrote', () => {
    // They have been in since being told, so this is news again.
    expect(
      awaitingNotice({ lastReadAt: t('2026-10-17T12:00:00Z'), notifiedAt: t('2026-10-17T09:00:00Z') }),
    ).toBe(true);
  });

  /** The case the rule exists for: a live back-and-forth. */
  it('stays quiet while an earlier notice is still unread', () => {
    expect(
      awaitingNotice({ lastReadAt: null, notifiedAt: t('2026-10-17T09:00:00Z') }),
    ).toBe(false);
    expect(
      awaitingNotice({ lastReadAt: t('2026-10-17T08:00:00Z'), notifiedAt: t('2026-10-17T09:00:00Z') }),
    ).toBe(false);
  });

  it('tells again when they read at the very moment they were told', () => {
    // Equal timestamps mean they have seen it; the next message is new.
    const at = t('2026-10-17T09:00:00Z');
    expect(awaitingNotice({ lastReadAt: at, notifiedAt: at })).toBe(true);
  });
});

describe('whether a member wants these at all', () => {
  it('writes to somebody who has never been asked', () => {
    // `emailOptIn` null is "never asked", which on a real co-op is almost
    // everybody. Treating null as "no" would silence the whole roster.
    expect(wantsEmail({ emailOptIn: null, messageEmails: true })).toBe(true);
  });

  it('respects the co-op-wide opt out', () => {
    expect(wantsEmail({ emailOptIn: false, messageEmails: true })).toBe(false);
  });

  it('respects this switch on its own', () => {
    expect(wantsEmail({ emailOptIn: true, messageEmails: false })).toBe(false);
  });

  it('does not let the co-op-wide opt-in override the member’s own off', () => {
    expect(wantsEmail({ emailOptIn: true, messageEmails: false })).toBe(false);
  });
});

describe('choosing who to write to', () => {
  const sender = participant({ userId: 'sender', email: 'me@example.com' });

  it('never writes to the person who just sent the message', () => {
    const out = recipientsFor([sender, participant({ userId: 'other' })], 'sender');

    expect(out.map((p) => p.userId)).toEqual(['other']);
  });

  it('writes to everybody else in a group thread', () => {
    const out = recipientsFor(
      [sender, participant({ userId: 'a' }), participant({ userId: 'b' })],
      'sender',
    );

    expect(out.map((p) => p.userId)).toEqual(['a', 'b']);
  });

  it('skips a participant with no address', () => {
    const out = recipientsFor([participant({ userId: 'a', email: null })], 'sender');

    expect(out).toEqual([]);
  });

  it('skips somebody who has already been told and not looked', () => {
    const out = recipientsFor(
      [participant({ userId: 'a', notifiedAt: t('2026-10-17T09:00:00Z') })],
      'sender',
    );

    expect(out).toEqual([]);
  });

  it('skips somebody who has switched these off', () => {
    const out = recipientsFor([participant({ userId: 'a', messageEmails: false })], 'sender');

    expect(out).toEqual([]);
  });
});

describe('the message in the email', () => {
  it('carries a short message whole', () => {
    expect(preview('Can you cover the Attic on Thursday?')).toEqual({
      text: 'Can you cover the Attic on Thursday?',
      truncated: false,
    });
  });

  it('collapses the whitespace a composer leaves behind', () => {
    expect(preview('  Hello\n\n   there  ').text).toBe('Hello there');
  });

  it('cuts a long message and says so', () => {
    const long = 'word '.repeat(300);
    const out = preview(long);

    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(PREVIEW_LIMIT);
  });

  it('cuts at a word rather than through one', () => {
    const out = preview(`${'alpha '.repeat(100)}omega`);

    expect(out.text.endsWith(' ')).toBe(false);
    // Nothing half-written at the end.
    expect(out.text.split(' ').pop()).toBe('alpha');
  });

  it('still cuts when there is no word boundary to cut at', () => {
    const out = preview('x'.repeat(1000));

    expect(out.truncated).toBe(true);
    expect(out.text.length).toBe(PREVIEW_LIMIT);
  });
});
