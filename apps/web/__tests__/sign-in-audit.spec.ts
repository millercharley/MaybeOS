import { readFileSync } from 'fs';
import { join } from 'path';
import type { SignInAudit } from '@/lib/api';
import {
  auditHeadline,
  auditRefusal,
  bounceIsFixable,
  cohortTitle,
  cohorts,
  looksLikeAQuotaWall,
} from '@/lib/sign-in-audit';

/**
 * Reading the migration send honestly (MEM-25).
 *
 * The real failure this is built around: Postmark's plan capped at a hundred
 * messages, MaybeOS marked 435 members as sent because it marks before it
 * sends, and this panel reported "nobody left waiting". 335 people were
 * recorded as told and had an empty inbox.
 */
function audit(over: Partial<SignInAudit> = {}): SignInAudit {
  return {
    checked: true,
    tally: { marked: 435, delivered: 100, bounced: 0, missing: 335, stalled: 91, neverSent: 0 },
    bounced: [],
    beyondRetention: false,
    checkedAt: '2026-10-07T12:00:00.000Z',
    ...over,
  };
}

describe('the headline', () => {
  it('names the gap between what was marked and what arrived', () => {
    const line = auditHeadline(audit());
    expect(line).toContain('435 MaybeOS had marked as sent');
    expect(line).toContain('100 reached');
    expect(line).toContain('335 never actually sent');
  });

  it('leaves out the parts that are zero', () => {
    const line = auditHeadline(
      audit({
        tally: { marked: 435, delivered: 435, bounced: 0, missing: 0, stalled: 4, neverSent: 0 },
      }),
    );
    expect(line).toContain('435 reached');
    expect(line).not.toContain('bounced');
    expect(line).not.toContain('never actually sent');
  });
});

describe('the groups offered', () => {
  it('leads with the people a failed send left waiting', () => {
    // They are the only group that cannot be seen any other way: every screen
    // in MaybeOS reads them as sent.
    const [first] = cohorts(audit());
    expect(first.scope).toBe('undelivered');
    expect(first.urgent).toBe(true);
    expect(cohortTitle(first)).toBe('335 members never actually got an email');
  });

  it('offers a nudge to the people who were reached and have not signed in', () => {
    const stalled = cohorts(audit()).find((c) => c.scope === 'not-signed-in');
    expect(stalled?.count).toBe(91);
  });

  it('offers nothing when there is nothing to do', () => {
    expect(
      cohorts(
        audit({
          tally: { marked: 435, delivered: 435, bounced: 0, missing: 0, stalled: 0, neverSent: 0 },
        }),
      ),
    ).toEqual([]);
  });

  it('never offers to re-send on the strength of an unchecked audit', () => {
    // Without a check, "missing" is unknown rather than zero, and writing to a
    // group derived from it would be a guess at several hundred inboxes.
    const groups = cohorts(audit({ checked: false, reason: 'incomplete' }));
    expect(groups.some((c) => c.scope === 'undelivered')).toBe(false);
    expect(groups.some((c) => c.scope === 'not-signed-in')).toBe(false);
  });

  it('still offers the first-time send, which needs no audit', () => {
    const groups = cohorts(
      audit({
        checked: false,
        reason: 'no-provider',
        tally: { marked: 0, delivered: 0, bounced: 0, missing: 0, stalled: 0, neverSent: 12 },
      }),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].scope).toBe('waiting');
  });
});

describe('declining to answer', () => {
  it('explains an unrecognised provider record without reporting zeroes', () => {
    const refusal = auditRefusal(audit({ checked: false, reason: 'unrecognised' }));
    expect(refusal).toMatch(/subject line/i);
    expect(refusal).toMatch(/nothing has been changed/i);
  });

  it('says a timed-out check wrote nothing down', () => {
    expect(auditRefusal(audit({ checked: false, reason: 'incomplete' }))).toMatch(
      /nothing has been written down/i,
    );
  });

  it('says nothing at all when the check succeeded', () => {
    expect(auditRefusal(audit())).toBeNull();
  });
});

describe('naming the cause', () => {
  it('calls out a sending limit when most of the send never landed', () => {
    // Without this an admin presses send again and watches the same thing
    // happen to the same people.
    expect(looksLikeAQuotaWall(audit())).toBe(true);
  });

  it('stays quiet about a handful of ordinary refusals', () => {
    expect(
      looksLikeAQuotaWall(
        audit({
          tally: { marked: 435, delivered: 430, bounced: 2, missing: 3, stalled: 9, neverSent: 0 },
        }),
      ),
    ).toBe(false);
  });
});

describe('bounces the admin can clear', () => {
  it('lets a broken address be retried once it is fixed', () => {
    expect(bounceIsFixable('Hard bounce — the address does not exist')).toBe(true);
  });

  it('will not let an admin overrule somebody who asked not to be written to', () => {
    expect(bounceIsFixable('Marked as spam — do not write again')).toBe(false);
    expect(bounceIsFixable('Unsubscribed')).toBe(false);
  });
});

describe('the panel', () => {
  const source = readFileSync(
    join(__dirname, '..', 'components', 'settings', 'sign-in-links.tsx'),
    'utf8',
  );

  // Comments quote the very labels these guards look for, and have broken this
  // kind of test before. Strip them first.
  const code = source.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/\/\/.*$/gm, '');

  it('offers the check against the provider', () => {
    expect(code).toMatch(/>\s*\{busy \? 'Checking…' : audit \? 'Check again' : 'Check with the provider'\}\s*</);
  });

  it('confirms before each send, whichever group it is for', () => {
    // The one action that lands in hundreds of inboxes at once. Every path to
    // it goes through setConfirming first.
    expect(code).toMatch(/setConfirming\(cohort\.scope\)/);
    expect(code).toMatch(/setConfirming\('waiting'\)/);
    expect(code).not.toMatch(/onClick=\{\(\) => send\(cohort\.scope\)\}[\s\S]{0,120}btn-secondary mt-3/);
  });

  it('re-reads the provider after sending, rather than counting its own sends', () => {
    // The original bug in one line: trusting what MaybeOS marked.
    expect(code).toMatch(/setAudit\(await api\.members\.auditSignInLinks/);
  });

  it('tells the admin when the provider refused some of them', () => {
    expect(code).toMatch(/failedTotal > 0/);
    expect(code).toMatch(/back in the queue/);
  });

  /*
    The way out of the bounce loop (MEM-25).

    A hard bounce flagged with nothing but "try again" sends the same message
    to the same dead address. The address has to be editable where it is
    discovered, or the admin reads it off this screen and retypes it elsewhere.
  */
  it('lets the address be corrected from the line it bounced on', () => {
    expect(code).toMatch(/>\s*Edit address\s*</);
    expect(code).toMatch(/api\.members\.changeEmail\(org\.id, editing\.userId/);
  });

  it('starts the edit from the address that bounced, not an empty box', () => {
    // Most corrections are a typo in a domain. Retyping the whole thing from
    // scratch is how a second typo gets in.
    expect(code).toMatch(/setEditing\(\{ userId: member\.userId, email: member\.email \}\)/);
  });

  it('says what the field is before the admin commits to it', () => {
    // It is a credential, not a profile field.
    expect(code).toMatch(/what they sign in with/);
  });

  it('re-reads the audit after a correction, rather than editing the list in place', () => {
    const save = code.slice(code.indexOf('async function saveEmail'));
    expect(save).toMatch(/setAudit\(await api\.members\.auditSignInLinks/);
  });
});
