import type { ErrorEvent, EventHint, Breadcrumb } from '@sentry/nextjs';

/**
 * Scrubbing and filtering shared by the browser, Node, and edge Sentry
 * initializations. Kept in one place so a rule added for one runtime can't
 * silently be missing from another.
 */

/**
 * Query parameters that carry a working credential.
 *
 * This is not hypothetical hygiene. Two live routes put a bearer token
 * directly in the URL:
 *
 *   /magic-link?token=...   → exchanges for a session (app/(auth)/magic-link)
 *   /invite?token=...       → accepts an org invitation (app/invite)
 *
 * Sentry attaches the current page URL to every event and to navigation and
 * fetch breadcrumbs. Any error thrown while one of those pages is open would
 * therefore ship a usable login credential into a third-party dashboard —
 * and errors are exactly what those pages produce when a token is expired or
 * already consumed. Redaction happens before anything leaves the browser.
 */
const SENSITIVE_QUERY_KEYS = ['token', 'access_token', 'code', 'secret', 'password', 'key'];

const REDACTED = '[redacted]';

/** Replace the value of any sensitive query parameter, preserving the rest. */
export function scrubUrl(url: string): string {
  if (!url) return url;

  try {
    // Relative URLs are common in breadcrumbs, so parse against a throwaway
    // base and only re-serialize the parts we were given.
    const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(url);
    const parsed = new URL(url, isAbsolute ? undefined : 'http://localhost');

    let touched = false;
    for (const key of SENSITIVE_QUERY_KEYS) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, REDACTED);
        touched = true;
      }
    }
    if (!touched) return url;

    return isAbsolute ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    // A URL we can't parse is a URL we can't verify is safe. Strip the query
    // string wholesale rather than let an unknown shape through.
    const q = url.indexOf('?');
    return q === -1 ? url : `${url.slice(0, q)}?${REDACTED}`;
  }
}

/**
 * Errors that are noise rather than defects. Every entry here is something a
 * healthy production app emits routinely; leaving them in buries the real
 * failures this whole exercise exists to surface.
 *
 * Important: `ignoreErrors` matches on message no matter how the event was
 * captured, including an explicit captureException. The bare fetch-failure
 * strings below are ambient noise — a user switching tabs, walking out of
 * wifi, an ad blocker — and they flood a project if left in. But "the API is
 * unreachable" is precisely the failure OPS-07 exists to catch, so the API
 * client deliberately re-wraps those in ApiNetworkError with a message shaped
 * like `API unreachable: POST /auth/login`, which matches nothing here and is
 * always reported. Do not add a generic /fetch/i pattern to this list — it
 * would swallow that signal too.
 */
const IGNORED_ERRORS = [
  // The user navigated away or lost connectivity mid-request.
  'AbortError',
  'Failed to fetch',
  'NetworkError when attempting to fetch resource',
  'Load failed',
  // Next.js App Router throws these internally to drive navigation and
  // not-found rendering; they are control flow, not errors.
  'NEXT_REDIRECT',
  'NEXT_NOT_FOUND',
  // Browser extensions and embedded webviews, injected into our page.
  'ResizeObserver loop',
];

export function scrubEvent(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  if (event.request) {
    if (event.request.url) {
      event.request.url = scrubUrl(event.request.url);
    }
    if (typeof event.request.query_string === 'string') {
      event.request.query_string = scrubUrl(`?${event.request.query_string}`).replace(/^\?/, '');
    }
    if (event.request.headers) {
      delete event.request.headers['authorization'];
      delete event.request.headers['Authorization'];
      delete event.request.headers['cookie'];
      delete event.request.headers['Cookie'];
    }
  }

  // The breadcrumb trail is the most useful part of a frontend report and the
  // easiest place for a token to hide, since every navigation and fetch lands
  // here.
  if (event.breadcrumbs) {
    for (const crumb of event.breadcrumbs) {
      scrubBreadcrumbInPlace(crumb);
    }
  }

  return event;
}

function scrubBreadcrumbInPlace(crumb: Breadcrumb): void {
  const data = crumb.data as Record<string, unknown> | undefined;
  if (data) {
    for (const key of ['url', 'from', 'to']) {
      if (typeof data[key] === 'string') {
        data[key] = scrubUrl(data[key] as string);
      }
    }
  }
  if (typeof crumb.message === 'string' && crumb.message.includes('token=')) {
    crumb.message = scrubUrl(crumb.message);
  }
}

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  scrubBreadcrumbInPlace(crumb);
  return crumb;
}

/** Options that should be identical across every runtime. */
export const sharedOptions = {
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',

  // Traces are the expensive part of the quota and this is a small co-op
  // deployment, not a service that needs statistically dense sampling.
  // Matches apps/api/src/instrument.ts.
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  ignoreErrors: IGNORED_ERRORS,

  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
};
