import { safePath } from '../api';

/**
 * `safePath` reduces a request path to a route label for Sentry (OPS-10).
 *
 * It has two jobs and they pull in opposite directions: never let a credential
 * into a label, and collapse dynamic segments so one endpoint is one issue.
 * An earlier version resolved that tension by length — anything 24+ characters
 * became `:token` — which split `/orgs/by-slug/sunrise` and
 * `/orgs/by-slug/maybeitsfate-land-cooperative` into different issues and
 * labelled a public slug as a credential. It shipped, and only a production
 * trace caught it, because apps/web had no test harness at all.
 *
 * These tests pin both jobs, and specifically pin the case that regressed:
 * two orgs with very different slug lengths must produce one label.
 */
describe('safePath', () => {
  describe('never leaks a credential', () => {
    it('drops the query string, where every token in this client lives', () => {
      expect(safePath('/invites?token=abc123secret')).toBe('/invites');
      expect(safePath('/invites/accept?token=abc123secret')).toBe('/invites/accept');
    });

    it('collapses a long opaque path segment as a backstop', () => {
      // Nothing puts a credential in the path today; this guards the day
      // something does.
      const token = 'a'.repeat(40);
      expect(safePath(`/magic/${token}`)).toBe('/magic/:token');
    });

    it('leaves a short segment alone — it is not credential-shaped', () => {
      expect(safePath('/orgs/by-slug/sunrise')).toBe('/orgs/by-slug/:slug');
    });
  });

  describe('one endpoint is one label', () => {
    it('collapses a UUID', () => {
      expect(safePath('/orgs/caa6cb05-f5a6-458a-a1bd-4b046e628a34/events')).toBe(
        '/orgs/:org/events',
      );
    });

    it('collapses UUIDs in every position, not just the first', () => {
      expect(
        safePath(
          '/orgs/caa6cb05-f5a6-458a-a1bd-4b046e628a34/events/1a54cbc0-e9e5-4a35-b3c9-419cc92b8f33/attendees',
        ),
      ).toBe('/orgs/:org/events/:id/attendees');
    });

    it('gives two orgs of very different slug lengths the same label', () => {
      // The exact regression: label-by-length made these two separate Sentry
      // issues for the same endpoint.
      const short = safePath('/orgs/by-slug/sunrise');
      const long = safePath('/orgs/by-slug/maybeitsfate-land-cooperative');

      expect(short).toBe(long);
      expect(short).toBe('/orgs/by-slug/:slug');
    });

    it('collapses an org addressed by slug rather than id', () => {
      expect(safePath('/orgs/sunrise/events/public')).toBe('/orgs/:org/events/public');
    });

    it('is idempotent, so an already-collapsed label is not re-collapsed', () => {
      const once = safePath('/orgs/caa6cb05-f5a6-458a-a1bd-4b046e628a34/members');
      expect(safePath(once)).toBe(once);
    });

    it('does not mangle a static path', () => {
      expect(safePath('/auth/login')).toBe('/auth/login');
      expect(safePath('/orgs/by-slug/sunrise?x=1')).toBe('/orgs/by-slug/:slug');
    });
  });

  describe('the labels the app actually produces', () => {
    // Walking real call sites keeps the tests honest about the shapes that
    // occur, rather than the shapes that are easy to write.
    it.each([
      ['/orgs/caa6cb05-f5a6-458a-a1bd-4b046e628a34/impact/dashboard', '/orgs/:org/impact/dashboard'],
      ['/orgs/caa6cb05-f5a6-458a-a1bd-4b046e628a34/me/demographics', '/orgs/:org/me/demographics'],
      ['/public/events/sunrise/community-potluck-dinner', '/public/events/sunrise/community-potluck-dinner'],
      ['/auth/profile', '/auth/profile'],
    ])('%s → %s', (input, expected) => {
      expect(safePath(input)).toBe(expected);
    });
  });
});
