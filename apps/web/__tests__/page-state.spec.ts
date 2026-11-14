import { stripComments } from './helpers/source-scan';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  PAGE_PRESENT,
  readPageState,
  watchPageLifecycle,
  whyNotReported,
  worthReporting,
} from '@/lib/page-state';

/**
 * Whether anybody was still waiting for the answer (OPS-43).
 *
 * Fifteen Sentry issues, 195 reports in a month, titled "Can't reach MaybeOS
 * right now" — and on reading them, one failure mode: 94% from a phone, 69%
 * of the largest on `/`, `/login` or `/magic-link`, arriving four-in-a-second
 * from one member as a page load's parallel requests all died together. The
 * browser's own word for it was `TypeError: Load failed`, a request it
 * abandoned rather than a response it received.
 */
describe('whether a failed request is news', () => {
  it('is, for a page that is on screen and staying', () => {
    expect(worthReporting(PAGE_PRESENT)).toBe(true);
  });

  it.each([
    ['the tab is in the background', { hidden: true, leaving: false }],
    ['the page is being torn down', { hidden: false, leaving: true }],
    ['both at once, as a locked phone is', { hidden: true, leaving: true }],
  ])('is not, when %s', (_label, state) => {
    expect(worthReporting(state)).toBe(false);
  });

  /** The breadcrumb says which, because "suppressed" explains nothing. */
  it('says which of the two it was', () => {
    expect(whyNotReported({ hidden: true, leaving: false })).toBe('hidden');
    expect(whyNotReported({ hidden: false, leaving: true })).toBe('leaving');
    expect(whyNotReported(PAGE_PRESENT)).toBeNull();
  });

  /** Leaving wins: it is the more specific fact about the same moment. */
  it('names leaving over hidden when both are true', () => {
    expect(whyNotReported({ hidden: true, leaving: true })).toBe('leaving');
  });
});

describe('reading the page', () => {
  const hide = (state: 'visible' | 'hidden') =>
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state,
    });

  afterEach(() => hide('visible'));

  it('reports a visible tab as present', () => {
    hide('visible');
    expect(readPageState()).toEqual({ hidden: false, leaving: false });
  });

  it('reports a hidden tab as hidden', () => {
    hide('hidden');
    expect(readPageState().hidden).toBe(true);
  });

  /**
   * The bug this exists to prevent.
   *
   * A page frozen into the back/forward cache fires `pagehide` and is then
   * *restored*, alive and interactive. Without the `pageshow` listener,
   * `leaving` stays true for the rest of that page's life and every genuine
   * failure after it is silently dropped — a worse version of the problem
   * this whole change is fixing.
   */
  it('stops treating a restored page as leaving', () => {
    watchPageLifecycle();

    window.dispatchEvent(new Event('pagehide'));
    expect(readPageState().leaving).toBe(true);
    expect(worthReporting(readPageState())).toBe(false);

    window.dispatchEvent(new Event('pageshow'));
    expect(readPageState().leaving).toBe(false);
    expect(worthReporting(readPageState())).toBe(true);
  });

  /** Called at import in `api.ts`, which is also imported on the server. */
  it('attaches its listeners only once', () => {
    const before = jest.spyOn(window, 'addEventListener');
    watchPageLifecycle();
    watchPageLifecycle();

    expect(before).not.toHaveBeenCalled();
    before.mockRestore();
  });
});

/**
 * And the timer both live pollers now share.
 *
 * A source scan: the behaviour is a timer that is not scheduled, and this
 * app's harness renders no components.
 */
describe('the shared poller', () => {
  const RAW = readFileSync(join(__dirname, '..', 'hooks', 'use-poll.ts'), 'utf8');

  /*
    Comments stripped, because the file explains the very thing it must not
    contain — "`setTimeout` rather than `setInterval`" trips a scan for
    `setInterval`. The same lesson as `unread-polling` and the embed scans: a
    file that fixes a bug also describes it.
  */
  const SOURCE = stripComments(RAW);

  it('really did strip its comments', () => {
    expect(RAW).toContain('rather than `setInterval`');
    expect(SOURCE).not.toContain('rather than `setInterval`');
  });

  it('uses no fixed interval', () => {
    expect(SOURCE).not.toContain('setInterval');
  });

  /*
    Sliced to the function body, not searched file-wide — the lesson from
    `unread-polling`, where asserting that `watching()` appeared *somewhere*
    survived deleting the guard, because the helper was still defined above.
  */
  const body = (name: string) => {
    const start = SOURCE.indexOf(`const ${name} = `);
    expect(start).toBeGreaterThan(-1);
    const rest = SOURCE.slice(start);
    const end = rest.indexOf('\n    };');
    return rest.slice(0, end === -1 ? rest.length : end);
  };

  it('refuses to schedule anything for a hidden tab', () => {
    expect(body('schedule')).toContain('!watching()');
    expect(SOURCE).toContain("document.visibilityState !== 'hidden'");
  });

  it('starts again, and refreshes, when the tab is shown', () => {
    expect(SOURCE).toContain("addEventListener('visibilitychange'");
    expect(SOURCE).toContain("removeEventListener('visibilitychange'");
    expect(body('onVisibility')).toContain('void tick()');
  });

  /** A tick is background; the first load, which somebody opened, is not. */
  it('marks ticks as background and the first load as foreground', () => {
    expect(body('tick')).toContain('latest.current(true)');
    expect(SOURCE).toContain('Promise.resolve(latest.current(false))');
  });

  /**
   * The callback is read through a ref on purpose. With `run` in the effect's
   * dependencies, a caller that rebuilds it each render restarts the timer
   * every time and it never ticks at all.
   */
  it('does not restart its timer when the callback changes identity', () => {
    expect(SOURCE).toMatch(/\}, \[enabled, everyMs\]\);/);
  });

  /** SSR has no `document`; both callers are client components regardless. */
  it('does not assume a browser', () => {
    expect(SOURCE).toContain("typeof document === 'undefined'");
  });
});
