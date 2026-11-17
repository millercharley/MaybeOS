import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/source-scan';

/**
 * One conversation per event, per offering (CMN-22).
 *
 * Charley: "all comments on an event page or teaching page should sync to the
 * identical conversation in the Commons. This prevents two places with
 * separate conversations about the same event."
 *
 * Nothing syncs, and that is the design: both pages run against the Commons
 * post the thing carries, so a comment typed on an event page is the same row
 * as one typed in #Events. There is no second store, so there is nothing to
 * keep in step and nothing to disagree.
 *
 * This is what notices the day somebody gives one of these pages its own
 * comment state "just for now".
 */
const read = (...parts: string[]) =>
  stripComments(readFileSync(join(__dirname, '..', ...parts), 'utf8'));

const EVENT_PAGE = ['app', '(app)', 'portal', '[orgSlug]', 'events', '[eventSlug]', 'page.tsx'];
const TEACHING_PAGE = ['app', '(app)', 'portal', '[orgSlug]', 'teaching', '[slug]', 'page.tsx'];
const DISCUSSION = ['components', 'commons', 'discussion.tsx'];

describe('both pages show the same conversation', () => {
  it.each([
    ['the event page', EVENT_PAGE],
    ['the teaching page', TEACHING_PAGE],
  ])('%s renders the shared Discussion', (_name, parts) => {
    const source = read(...parts);

    expect(source).toMatch(/<Discussion\b/);
    expect(source).toMatch(/from '@\/components\/commons\/discussion'/);
  });

  /**
   * The regression this exists for: a page growing its own comment list and
   * its own posting call, which is how two conversations about one evening
   * start.
   */
  it.each([
    ['the event page', EVENT_PAGE],
    ['the teaching page', TEACHING_PAGE],
  ])('%s keeps no comments of its own', (_name, parts) => {
    const source = read(...parts);

    expect(source).not.toMatch(/useState<Comment\[\]>/);
    expect(source).not.toMatch(/api\.commons\.addComment/);
    expect(source).not.toMatch(/api\.commons\.getPost/);
  });

  /** The one component that does, and the only one that may. */
  it('the shared component is the only thing posting a comment', () => {
    const discussion = read(...DISCUSSION);

    expect(discussion).toMatch(/api\.commons\.addComment/);
    expect(discussion).toMatch(/api\.commons\.getPost/);
    expect(discussion).toMatch(/api\.commons\.deleteComment/);
  });

  /**
   * Reading must never create. EVT-42 paid for this: opening an event page
   * posted into #Events under the name of whoever opened it, three times in
   * one browsing session.
   */
  it('reads the thread on load and only makes one when somebody writes', () => {
    const discussion = read(...DISCUSSION);

    const load = discussion.slice(discussion.indexOf('const load'), discussion.indexOf('async function submit'));
    expect(load).toMatch(/readThread\(\)/);
    expect(load).not.toMatch(/startThread\(\)/);

    const submit = discussion.slice(discussion.indexOf('async function submit'));
    expect(submit).toMatch(/startThread\(\)/);
  });

  /**
   * Both callers point at their own thread endpoints, and both of those are
   * a read and a create — not one route that does both.
   */
  it.each([
    ['events', EVENT_PAGE, /api\.events\.thread/, /api\.events\.startThread/],
    ['teaching', TEACHING_PAGE, /api\.teaching\.thread/, /api\.teaching\.startThread/],
  ])('%s passes a read and a create', (_name, parts, reader, starter) => {
    const source = read(...parts);

    expect(source).toMatch(reader);
    expect(source).toMatch(starter);
  });

  /**
   * Each post in the channel links to the thing it is about, so somebody
   * reading #Events can get to the page and RSVP (Charley, 2026-11-17).
   */
  it('the announcement carries a link to the page it is about', () => {
    const service = stripComments(
      readFileSync(
        join(__dirname, '..', '..', 'api', 'src', 'modules', 'commons', 'thread-post.service.ts'),
        'utf8',
      ),
    );

    expect(service).toMatch(/href="\$\{args\.href\}"/);
    expect(service).toMatch(/\/portal\/\$\{event\.org\.slug\}\/events\//);
    expect(service).toMatch(/\/portal\/\$\{offering\.org\.slug\}\/teaching\//);
  });
});
