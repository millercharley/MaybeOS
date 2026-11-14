/**
 * Whether the page that made a request is still there to receive the answer
 * (OPS-43).
 *
 * `fetch` rejects when a request never completed, and the API client reports
 * that as an unreachable API — which is right when the API is unreachable and
 * wrong in the case that turned out to produce nearly all of it.
 *
 * Fifteen Sentry issues, one per endpoint, 195 reports over a month. Reading
 * them: 94% came from a phone, 69% of the largest one happened on `/`,
 * `/login` or `/magic-link`, and they arrive in clumps — four different
 * endpoints filing four different issues in the *same second*, from the same
 * member. The browser's own word for it is `TypeError: Load failed`, WebKit's
 * wording for a request it abandoned rather than a response it received.
 *
 * That is one event, not four bugs: a member opened MaybeOS on a phone, the
 * page fired its nine parallel requests, and then the phone locked or they
 * switched apps. Every request in flight died at once. Nothing was broken —
 * `loadProfile` keeps the token, the badge keeps its last value, the panel
 * renders nothing — and nobody saw anything wrong.
 *
 * So the question this answers is not "did the request fail" but "was anybody
 * still waiting for it". A request whose page is hidden or already being torn
 * down fails for the member's circumstances, not ours, and reporting it buries
 * the case OPS-07 exists for: an API that genuinely cannot be reached, which
 * fails a *foreground* request that somebody is sitting and watching.
 *
 * Kept separate from `api.ts` and pure at the decision, because the judgement
 * is the whole thing and the browser plumbing around it is four lines.
 */

export interface PageState {
  /** The tab is in the background, or the phone is locked. */
  hidden: boolean;
  /**
   * `pagehide` has fired: this document is being unloaded, or frozen into the
   * back/forward cache.
   */
  leaving: boolean;
}

/** A page that is on screen and staying, which is every normal request. */
export const PAGE_PRESENT: PageState = { hidden: false, leaving: false };

/**
 * Whether a failed request is news.
 *
 * Both conditions mean the same thing from the member's side — the answer was
 * never going to be used — but they are tracked separately because they are
 * read from different places and because a breadcrumb that says which one it
 * was is worth more than one that says "suppressed".
 */
export function worthReporting(state: PageState): boolean {
  return !state.hidden && !state.leaving;
}

/** Which of the two it was, for the breadcrumb. Never both, by precedence. */
export function whyNotReported(state: PageState): 'leaving' | 'hidden' | null {
  if (state.leaving) return 'leaving';
  if (state.hidden) return 'hidden';
  return null;
}

/*
  The browser side. Module state rather than a React context: the API client
  is not a component and must be able to ask this from anywhere, including a
  request made outside the React tree.
*/

let leaving = false;
let watching = false;

/**
 * Start listening. Idempotent, and a no-op on the server.
 *
 * `pageshow` matters as much as `pagehide`, and leaving it out is the bug
 * worth naming: a page frozen into the back/forward cache fires `pagehide`
 * and is then *restored*, alive and interactive, with `leaving` still true
 * forever. Every real failure from that point on would be silently dropped —
 * a worse version of the problem this is fixing. `pageshow` puts it back.
 */
export function watchPageLifecycle(): void {
  if (typeof window === 'undefined' || watching) return;
  watching = true;

  window.addEventListener('pagehide', () => {
    leaving = true;
  });
  window.addEventListener('pageshow', () => {
    leaving = false;
  });
}

/** What the page looks like right now. `PAGE_PRESENT` when there is no DOM. */
export function readPageState(): PageState {
  if (typeof document === 'undefined') return PAGE_PRESENT;

  return { hidden: document.visibilityState === 'hidden', leaving };
}
