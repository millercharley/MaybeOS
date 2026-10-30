'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import { api } from '@/lib/api';
import { NO_UNREAD, type UnreadCounts } from '@/lib/unread';

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

/** How often to ask. */
const EVERY = 60_000;

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
  const load = useCallback(async (background = false) => {
    if (!orgId || !token) {
      setCounts(NO_UNREAD);
      return;
    }
    try {
      setCounts(await api.commons.unread(orgId, token, background));
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
      if (useAuthStore.getState().endSessionIfRejected(err)) return;

      /*
        Anything else stays quiet. This is an adornment on the navigation,
        polled every minute, and an error banner where a badge would be is
        worse than no badge — it would appear on every screen in the product
        the moment the API hiccups. The last known counts stay until the next
        run succeeds.
      */
    }
  }, [orgId, token]);

  useEffect(() => {
    load();
    if (!orgId || !token) return;

    // Not `setInterval(load, …)` — the timer hands its callback an argument,
    // and `load`'s first parameter is the one that decides whether a failure
    // is reported.
    const timer = setInterval(() => load(true), EVERY);
    return () => clearInterval(timer);
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
