import { stripComments } from './helpers/source-scan';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sentry cannot fail a production deploy (OPS-39).
 *
 * On 2 November a build died on `sentry-cli releases finalize`, which came
 * back `504 gateway timeout`. The source maps had already uploaded — only
 * the finalize call failed, and only because Sentry's API was briefly
 * unavailable. maybeos.org's deploy went down with it.
 *
 * The config already said this about a missing auth token: "error tracking is
 * not worth taking the site down for". An outage at Sentry is the same
 * bargain with worse timing, and it was not covered.
 *
 * A scan rather than a run, because the failure only happens with a live
 * Sentry token against a Sentry that is down — a local build has neither and
 * proves nothing either way.
 */
const CONFIG = readFileSync(join(__dirname, '..', 'next.config.ts'), 'utf8');

// Comments blanked, line breaks kept, and line comments go first.
//
// Two traps, both of which this file walked into before the order was right.
// A bare line-comment pattern matches the double slash inside a URL, so it is
// anchored to the start of a line. And a line comment in the config mentions
// the glob "chunks/app" followed by two stars — a sequence that opens a block
// comment — so stripping block comments first opened one there and blanked
// everything down to the next closing delimiter, taking `silent: false` with
// it. The assertion failed on a rule the config keeps.
//
// Removing whole-line comments first leaves no stray opener for the block
// pass to find. Written as line comments here for the same reason: the first
// draft of this note put a closing delimiter inside the block it was in, and
// ended the comment three lines early.
const CODE = stripComments(CONFIG);

describe('the build survives Sentry being unavailable', () => {
  it('does not finalize the release', () => {
    /*
      The call that actually failed. Finalizing only stamps a release with an
      end timestamp — the release is still created, the maps still attach,
      and a stack trace still resolves without it.
    */
    expect(CODE).toMatch(/release:\s*\{\s*\n\s*finalize:\s*false,/);
  });

  it('turns every other build-time step into a warning', () => {
    expect(CODE).toMatch(/unstable_sentryWebpackPluginOptions:\s*\{/);
    expect(CODE).toMatch(/errorHandler:\s*\(err: Error\) =>/);
  });

  it('puts the handler where this version actually reads it', () => {
    /*
      `errorHandler` is not a `withSentryConfig` option in @sentry/nextjs
      8.55 — Netlify's own advice to add one there does not apply — but it is
      an option of the bundler plugin underneath, and
      `unstable_sentryWebpackPluginOptions` is the documented way through. A
      handler at the top level would typecheck as an unknown key and silently
      do nothing.
    */
    const passthrough = CODE.indexOf('unstable_sentryWebpackPluginOptions');
    const handler = CODE.indexOf('errorHandler');
    expect(passthrough).toBeGreaterThan(-1);
    expect(handler).toBeGreaterThan(passthrough);
    // And it is inside that object, not a sibling further down.
    expect(CODE.slice(passthrough, handler)).not.toContain('},\n\n  org:');
  });

  it('says so in the log rather than swallowing it', () => {
    // A build that quietly stops uploading source maps is how production
    // stack traces turn back into minified soup with nobody noticing.
    expect(CODE).toMatch(/console\.warn\(/);
    expect(CODE).toMatch(/silent: false/);
  });

  it('keeps the handler from throwing, which would fail the build anyway', () => {
    // "compilation will continue, unless an error is thrown in the provided
    // callback" — so the handler logs and returns.
    const at = CODE.indexOf('errorHandler:');
    const body = CODE.slice(at, CODE.indexOf('},', at));
    expect(body).not.toMatch(/\bthrow\b/);
    expect(body).not.toMatch(/process\.exit/);
  });

  it('still refuses to ship source maps it could not upload', () => {
    // The older rule this must not undo: unuploaded maps would be served
    // publicly next to the bundle, handing anyone the unminified source.
    expect(CODE).toMatch(/disable: !canUploadSourcemaps/);
    expect(CODE).toMatch(/deleteSourcemapsAfterUpload: true/);
  });
});
