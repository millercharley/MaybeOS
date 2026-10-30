'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import { api } from '@/lib/api';
import {
  NO_UNREAD,
  POLL_BASE_MS,
  nextPollDelay,
  sameCounts,
  type UnreadCounts,
} from '@/lib/unread';

interface UnreadContextValue extends UnreadCounts {
  /** Ask again now — after opening a thread or a channel. */
  refresh: () => void;
  /**
   * Take a count down without waiting for the server (CMN-14).
   *
   * Opening a thread marks it read and the badge should go at once, not in
   * up to a minute. The server's own answer follows and wins.
   */
  settle: (counts: UnreadCounts) => void;
}

const UnreadContext = createContext<UnreadContextValue>({
  ...NO_UNREAD,
  refresh: () => {},
  settle: () => {},
});

/**
 * What this member has not read, for the whole signed-in app (CMN-14).
 *
 * A provider rather than a fetch inside the sidebar, for three reasons that
 * each caused a bug on their own in the surfaces that came before it:
 *
 * - **The sidebar renders twice** — a fixed column and a mobile drawer — so a
 *   fetch inside it is two requests a minute for one answer.
 * - **Marking something read happens somewhere else.** Opening a thread is on
 *   the messages page; the badge is in the chrome. Without shared state the
 *   badge stays wrong until the next poll, which is the single most obvious
 *   way for this feature to look broken.
 * - It sits beside `PortalProvider`, which is mounted unconditionally so the
 *   shell survives navigation (NAV-03). Anything that remounts per route
 *   would refetch on every click.
 *
 * Polls on a minute, copying `HappeningNow` — the only other live thing in
 * the app. Nothing is fetched when signed out or outside a co-op.
 */
export function UnreadProvider({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const [counts, setCounts] = useState<UnreadCounts>(NO_UNREAD);

  /*
    The co-op the session is in, which the sidebar uses too — not the URL,
    because the badge is drawn on `/member/...`, `/admin/...` and
    `/portal/...` alike and only the last of those names a co-op in the path.
    The dashboard layout keeps `currentOrgId` in step with the URL slug.
  */
  const orgId = currentOrgId ?? undefined;

  /**
   * `background` is true only for the ticks of the timer (OPS-09).
   *
   * Not for the first load, and not for `refresh()` — that one runs when
   * somebody has just opened a thread and is watching the badge go down.
   * Those are worth reporting if the API cannot be reached; a tick that
   * failed while the laptop was shut is not.
   */
  const load = useCallback(async (background = false): Promise<UnreadCounts | null> => {
    if (!orgId || !token) {
      setCounts(NO_UNREAD);
      return null;
    }
    try {
      const next = await api.commons.unread(orgId, token, background);
      setCounts(next);
      // Returned, not just stored: the timer below decides how long to wait
      // by asking whether this reading differs from the last (CMN-29).
      return next;
    } catch (err) {
      /*
        Quiet about a hiccup, but not about a refusal (OPS-37).

        This was a bare `catch {}`. A tab left open past its token's expiry
        therefore polled on, once a minute, for as long as it stayed open —
        getting 401 every time and telling nobody. On production that and its
        twin in `HappeningNow` were eighty requests in ninety minutes, about
        an eighth of all API traffic, each one waking a Lambda container and
        taking a database connection to be told no.

        Ending the session clears `token`, which makes the effect below tear
        the timer down on its own. The member then sees that they are signed
        out, which is the truth and was previously invisible: the badge simply
        stopped changing.
      */
      if (useAuthStore.getState().endSessionIfRejected(err)) return null;

      /*
        Anything else stays quiet. This is an adornment on the navigation,
        polled every minute, and an error banner where a badge would be is
        worse than no badge — it would appear on every screen in the product
        the moment the API hiccups. The last known counts stay until the next
        run succeeds.
      */
      return null;
    }
  }, [orgId, token]);

  useEffect(() => {
    if (!orgId || !token) {
      void load();
      return;
    }

    /*
      A timer that backs off, and stops for a tab nobody is looking at
      (CMN-29).

      This was `setInterval(load, 60_000)`, which asked once a minute for as
      long as a tab existed. Each ask costs seven database queries; over
      ninety minutes on production that was 417 polls and about 2,900 queries
      to render a number that changed twice. Express answered 304 to most of
      them, which saved the bandwidth and none of the work — by then the
      handler has run every query and hashed the result to find out.

      `setTimeout` rather than `setInterval`, because the delay now varies.
    */
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = POLL_BASE_MS;
    let last: UnreadCounts = NO_UNREAD;

    const watching = () =>
      typeof document === 'undefined' || document.visibilityState !== 'hidden';

    const schedule = () => {
      clearTimeout(timer);
      // Nothing is scheduled for a hidden tab. `visibilitychange` starts it
      // again, and refreshes immediately so the badge is right by the time
      // the member has finished looking at it.
      if (stopped || !watching()) return;
      timer = setTimeout(run, delay);
    };

    const run = async () => {
      const next = await load(true);
      if (stopped) return;

      if (next) {
        delay = nextPollDelay(delay, !sameCounts(next, last));
        last = next;
      }

      schedule();
    };

    const onVisibility = () => {
      if (!watching()) {
        clearTimeout(timer);
        return;
      }
      // Back to the front of the queue: somebody is looking again, and what
      // they most want is for the badge to be right now rather than in four
      // minutes.
      delay = POLL_BASE_MS;
      void run();
    };

    void load().then((first) => {
      if (first) last = first;
      schedule();
    });

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load, orgId, token]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return (
    <UnreadContext.Provider value={{ ...counts, refresh, settle: setCounts }}>
      {children}
    </UnreadContext.Provider>
  );
}

export function useUnread() {
  return useContext(UnreadContext);
}
