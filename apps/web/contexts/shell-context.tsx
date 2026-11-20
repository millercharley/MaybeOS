'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import { api, MUTATION_EVENT, type AppShell } from '@/lib/api';

interface ShellContextValue {
  shell: AppShell | null;
  /**
   * Which co-op this bundle is for.
   *
   * Carried explicitly rather than assumed, because a consumer seeding itself
   * from the bundle must not seed the *previous* co-op's badge into the new
   * one's chrome during the moment between the org changing and the new
   * bundle landing. Comparing this to `currentOrgId` makes that impossible
   * rather than unlikely.
   */
  shellOrgId: string | null;
  /**
   * Increments on every answer.
   *
   * A primitive, so a consumer can depend on "there is a new bundle" without
   * depending on the bundle object itself — whose identity changes on every
   * refetch and would restart a poll timer for no reason.
   */
  stamp: number;
  /**
   * The request has come back, one way or the other.
   *
   * Consumers need this rather than `shell !== null`, because a bundle that
   * failed and a bundle that has not arrived look identical otherwise — and
   * one of them means "draw the empty state" while the other means "wait".
   * The getting-started checklist got this wrong once and flashed its empty
   * state on every page load.
   */
  ready: boolean;
  /** Ask again — after a mutation, or when a consumer knows it is stale. */
  refresh: () => void;
}

const ShellContext = createContext<ShellContextValue>({
  shell: null,
  shellOrgId: null,
  stamp: 0,
  ready: false,
  refresh: () => {},
});

/**
 * One request for the chrome, instead of four (OPS-47).
 *
 * The shell rendered four providers side by side — unread, onboarding, links
 * and the required-reading gate — each with its own `useEffect` on the same
 * two values, `token` and `currentOrgId`. Four requests, every page, for one
 * question: what does the chrome need for this member in this co-op.
 *
 * This sits above all four and asks once. Each of them keeps its own context
 * and its own public shape, so no call site in the product changed; what
 * changed is where the first answer comes from.
 *
 * **Mounted unconditionally**, for the reason the whole layout file is about
 * (NAV-03): a provider that comes and goes between routes changes the tree's
 * shape and remounts everything beneath it, which is the bug that made the
 * sidebar blink and refetch on every navigation. Signed out, or outside a
 * co-op, it fetches nothing and reports `ready` so the chrome draws.
 *
 * It listens for `MUTATION_EVENT` because two of its four did. One refresh
 * now updates all four, where before a mutation cost two separate requests.
 */
export function ShellProvider({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);
  /*
    Readiness is per co-op, not global, and that distinction is the whole
    correctness of the seeding below.

    The first version kept a plain `ready` flag. On a cold load the store has
    no token yet — `init` is still reading localStorage — so this provider's
    first pass took the signed-out branch and set `ready` true. By the time
    the token arrived, every consumer already saw a bundle that had "answered",
    found no section for their co-op, and fell through to fetching for itself.
    Measured on a production build: the bundle *and* all four, eight requests
    where there had been five.

    So the answer is stored with the key it answered for, and `ready` is that
    key matching the one being asked about now. A stale yes is then not
    expressible.
  */
  const key = token && orgId ? orgId : null;
  const [answered, setAnswered] = useState<{ key: string | null; shell: AppShell | null } | null>(
    null,
  );
  const [stamp, setStamp] = useState(0);

  const ready = answered !== null && answered.key === key;
  const shell = ready ? answered.shell : null;
  const shellOrgId = ready ? answered.key : null;

  const load = useCallback(async () => {
    if (!token || !orgId) {
      setAnswered({ key: null, shell: null });
      setStamp((n) => n + 1);
      return;
    }
    try {
      const next = await api.orgs.shell(orgId, token);
      setAnswered({ key: orgId, shell: next });
    } catch (err) {
      /*
        Quiet about a hiccup, but not about a refusal (OPS-37).

        A tab left open past its token's expiry would otherwise refetch this
        on every navigation, get 401 every time and tell nobody — the shape
        of the bug the unread poll had, where eighty requests in ninety
        minutes were an eighth of all API traffic. Ending the session makes
        the member see that they are signed out, which is the truth.
      */
      if (useAuthStore.getState().endSessionIfRejected(err)) {
        setAnswered({ key: null, shell: null });
        return;
      }
      /*
        Answered, with nothing.

        Recorded under this co-op's key on purpose: the consumers are waiting
        on it, and a bundle that failed must release them to ask for
        themselves. Leaving it unanswered would hold the chrome blank for as
        long as the tab stayed open — a worse failure than the four requests
        this exists to remove.
      */
      setAnswered({ key: orgId, shell: null });
    } finally {
      setStamp((n) => n + 1);
    }
  }, [token, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const again = () => void load();
    window.addEventListener(MUTATION_EVENT, again);
    return () => window.removeEventListener(MUTATION_EVENT, again);
  }, [load]);

  return (
    <ShellContext.Provider
      value={{ shell, shellOrgId, stamp, ready, refresh: () => void load() }}
    >
      {children}
    </ShellContext.Provider>
  );
}

export const useShell = () => useContext(ShellContext);
