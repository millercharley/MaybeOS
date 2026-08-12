import { tenantFromHost } from '@/lib/tenant-host';

/**
 * Which hostnames address a co-op, and which address the app (SCL-01).
 *
 * The rule used to be "three or more labels in the hostname", which is true of
 * the site's own Netlify hostname, of every deploy preview, and of an IP
 * address. On those hosts every public page rewrote to a portal for an org
 * that does not exist — so the product worked on maybeos.org and 404'd on the
 * exact URLs used to check a release before it ships.
 *
 * These cases are the hostnames this app is actually served on.
 */
describe('tenantFromHost', () => {
  describe('addresses a co-op', () => {
    it.each([
      ['sunrise.maybeos.org', 'sunrise'],
      ['sunrise.maybeos.org:3000', 'sunrise'],
      ['MaybeItsFate.MaybeOS.org', 'maybeitsfate'],
      ['maybeitsfate-land-cooperative.maybeos.org', 'maybeitsfate-land-cooperative'],
    ])('%s → %s', (host, slug) => {
      expect(tenantFromHost(host)).toBe(slug);
    });
  });

  describe('addresses the app itself', () => {
    it.each([
      // The bug: the site's own Netlify hostname.
      ['maybeos-web-prod.netlify.app'],
      ['deploy-preview-12--maybeos-web-prod.netlify.app'],
      // Four labels, and "127" is not a co-op.
      ['127.0.0.1:3000'],
      ['localhost:3000'],
      ['localhost'],
      // The apex, with and without a port.
      ['maybeos.org'],
      ['maybeos.org:443'],
      // Reserved platform subdomains.
      ['www.maybeos.org'],
      ['app.maybeos.org'],
      ['api.maybeos.org'],
      // Not a subdomain of a root domain — a lookalike host must not be
      // allowed to name a co-op.
      ['sunrise.maybeos.org.evil.test'],
      ['notmaybeos.org'],
      ['sunrise.notmaybeos.org'],
      // Nested labels are not a co-op called "a.b".
      ['a.b.maybeos.org'],
      // Empty.
      [''],
    ])('%s → null', (host) => {
      expect(tenantFromHost(host)).toBeNull();
    });
  });

  it('does not mistake a suffix match for a subdomain', () => {
    // `endsWith(root)` alone would accept this; the check requires the dot.
    expect(tenantFromHost('evilmaybeos.org')).toBeNull();
  });
});
