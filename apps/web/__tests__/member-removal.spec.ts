import { readFileSync } from 'fs';
import { join } from 'path';
import { payingDues } from '@/lib/member-removal';

/**
 * Removing a member from the Members page (MEM-20).
 *
 * The kebab menu on this page had no click handler at all — it rendered three
 * dots and did nothing. That is the only reason nobody had met the bug
 * underneath it: the removal endpoint deleted the membership and never told
 * Stripe, so a removed member kept being billed and the row holding their
 * subscription id was gone.
 */

describe('who is warned that their dues stop today', () => {
  it('warns for a subscription Stripe would charge again', () => {
    for (const subscriptionStatus of ['ACTIVE', 'TRIALING', 'PAST_DUE', 'UNPAID', 'INCOMPLETE']) {
      expect(payingDues({ subscriptionStatus })).toBe(true);
    }
  });

  it('stays quiet for somebody who is not paying', () => {
    // A warning that appears on every member is a warning nobody reads, and
    // this one is the difference between tidying a roster and taking money.
    expect(payingDues({ subscriptionStatus: 'CANCELED' })).toBe(false);
    expect(payingDues({ subscriptionStatus: 'NONE' })).toBe(false);
    expect(payingDues({ subscriptionStatus: null })).toBe(false);
    expect(payingDues({})).toBe(false);
  });

  it('does not care how the status was cased', () => {
    expect(payingDues({ subscriptionStatus: 'active' })).toBe(true);
  });
});

describe('the menu is wired to something', () => {
  const page = readFileSync(
    join(__dirname, '..', 'app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'members', 'page.tsx'),
    'utf8',
  );

  it('opens on a click', () => {
    // The original button had no onClick. It looked finished.
    expect(page).toMatch(/setOpenMenu\(openMenu === member\.id \? null : member\.id\)/);
  });

  it('closes when the admin clicks elsewhere', () => {
    expect(page).toMatch(/onClick=\{\(\) => setOpenMenu\(null\)\}/);
  });

  it('asks before removing anybody', () => {
    // No remove call may be reachable from the menu item itself.
    expect(page).toMatch(/setConfirmRemove\(member\)/);
    expect(page).toMatch(/api\.members\.remove\(/);
  });

  it('says dues are cancelled immediately and not refunded', () => {
    expect(page).toMatch(/cancelled immediately/);
    expect(page).toMatch(/not\s+refunded/);
  });

  it('says it cannot be undone', () => {
    expect(page).toMatch(/cannot be undone/);
  });

  it('does not use window.confirm', () => {
    // It is suppressed in some browsers, including the one this was tested in,
    // which would make the destructive action silently do nothing.
    expect(page).not.toMatch(/window\.confirm/);
  });

  it('shows the failure rather than leaving the admin guessing', () => {
    expect(page).toMatch(/setRemoveError\(/);
    expect(page).toMatch(/\{removeError\}/);
  });
});
