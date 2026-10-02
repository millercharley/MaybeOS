import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Where a migrating co-op's settings live (MIG-04).
 *
 * Billing for imported members, sign-in links and the calendar import were
 * all at the foot of General — below the co-op's name, slug, mission,
 * timezone, tiers, welcome email and door access. Several screens down from
 * anybody mid-migration, and they are the three most likely to be wanted in
 * the same hour. They also stop mattering once a co-op has moved, which is
 * the argument for a tab of their own rather than more of General's.
 */

const page = readFileSync(
  join(__dirname, '..', 'app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'settings', 'page.tsx'),
  'utf8',
);

const order = (key: string) => page.indexOf(`{ key: '${key}'`);

describe('the settings tabs', () => {
  it('has a Migration tab', () => {
    expect(page).toMatch(/\{ key: 'migration', label: 'Migration' \}/);
  });

  it('puts it between Getting started and Integrations', () => {
    expect(order('onboarding')).toBeLessThan(order('migration'));
    expect(order('migration')).toBeLessThan(order('integrations'));
  });

  it('puts Radar after Integrations', () => {
    expect(order('integrations')).toBeLessThan(order('radar'));
  });

  it('keeps every tab it had', () => {
    for (const key of ['general', 'branding', 'website', 'onboarding', 'radar', 'integrations', 'billing']) {
      expect(order(key)).toBeGreaterThan(-1);
    }
  });
});

describe('what moved onto it', () => {
  const mounted = (component: string) =>
    new RegExp(`activeTab === 'migration' && org && <${component}\\b`).test(page);

  it('carries all three', () => {
    expect(mounted('LegacyBilling')).toBe(true);
    expect(mounted('SignInLinks')).toBe(true);
    expect(mounted('CalendarImport')).toBe(true);
  });

  it('leaves none of them behind on General', () => {
    // Mounted twice would be worse than not moving them: two copies of a
    // control that writes to the same setting.
    for (const component of ['LegacyBilling', 'SignInLinks', 'CalendarImport']) {
      expect(page).not.toMatch(new RegExp(`activeTab === 'general' && org && <${component}\\b`));
    }
  });

  it('orders them the way a migration happens', () => {
    // Settle where members still pay, then write to them, then give them
    // something to find when they arrive.
    const at = (c: string) => page.indexOf(`activeTab === 'migration' && org && <${c}`);

    expect(at('LegacyBilling')).toBeLessThan(at('SignInLinks'));
    expect(at('SignInLinks')).toBeLessThan(at('CalendarImport'));
  });
});

describe('what points at it', () => {
  it('the import screen sends an admin to the right tab', () => {
    const importPage = readFileSync(
      join(__dirname, '..', 'app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'members', 'import', 'page.tsx'),
      'utf8',
    );

    expect(importPage).toMatch(/Settings → Migration/);
    expect(importPage).not.toMatch(/Settings → General/);
  });
});
