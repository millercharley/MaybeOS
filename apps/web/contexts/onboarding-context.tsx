'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/lib/auth-store';
import { api, MUTATION_EVENT, OnboardingState } from '@/lib/api';

interface OnboardingContextValue {
  /** Null when the co-op runs no checklist, or this member has put it away. */
  state: OnboardingState | null;
  /** False until the first answer is in. Nothing should draw before then. */
  ready: boolean;
  /** Ask again now. */
  refresh: () => void;
  /** Take the server's answer from a tick or a dismissal, without re-asking. */
  settle: (state: OnboardingState | null) => void;
}

const OnboardingContext = createContext<OnboardingContextValue>({
  state: null,
  ready: false,
  refresh: () => {},
  settle: () => {},
});

/**
 * The getting-started checklist, fetched once for the whole signed-in app
 * (ONB-01, ONB-03).
 *
 * It used to be fetched inside the checklist component, which was fine while
 * the checklist was the only thing that wanted it. It is not any more:
 *
 * - **The sidebar renders twice** — the fixed column and the mobile drawer.
 *   The fixed one is `hidden lg:block`, which is CSS, not React: it mounts
 *   and fetches on a phone too. With the drawer open that was already two
 *   requests for one answer.
 * - **The dashboard wants the same answer**, to say "welcome in" when the
 *   last box is ticked (ONB-03). That made three.
 * - **Finishing a step happens somewhere else entirely.** A member follows
 *   "Do it now" to their profile, fills it in and saves — and without shared
 *   state the checklist in the nav and the acknowledgement on the dashboard
 *   would learn about it at different moments and disagree on screen.
 *
 * Mounted unconditionally beside `UnreadProvider`, for the reason that file
 * gives: a provider that comes and goes between routes changes the tree's
 * shape and remounts the shell under it (NAV-03).
 */
export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);
  const pathname = usePathname();

  const [state, setState] = useState<OnboardingState | null>(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    if (!token || !orgId) {
      setState(null);
      setReady(true);
      return;
    }
    try {
      setState(await api.onboarding.mine(orgId, token));
    } catch {
      // A checklist is not worth an error anywhere. If it cannot load, the
      // nav is simply the nav and the dashboard is simply the dashboard.
      setState(null);
    } finally {
      setReady(true);
    }
  }, [token, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Re-read on navigation, and after anything is saved.
   *
   * Every built-in step is derived from what the member has actually done, so
   * the moment they finish their profile or say hello in the Commons the tick
   * is already true on the server — it has just not been asked for.
   *
   * Navigation alone is not enough, and the case that proves it is the
   * obvious one: a member follows "Do it now" to their profile, fills it in,
   * saves, and stays on the page. The step they were sent to do is done and
   * the checklist still says it is not. So this also listens for the api
   * client's mutation announcement, which fires after any successful non-GET
   * request — one hook covering every save in the product rather than a
   * callback wired into each page a step can point at.
   *
   * Debounced, because a save is often several requests in a row: a profile
   * write and a membership write land together, and two reads of the same
   * checklist is one wasted.
   */
  const seenPath = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 400);
    };

    // Only when the address actually changed. This effect also re-runs when
    // `ready` flips, and firing then would ask for the same checklist the
    // mount already fetched — two requests for one page.
    if (seenPath.current !== null && seenPath.current !== pathname) refresh();
    seenPath.current = pathname ?? null;

    window.addEventListener(MUTATION_EVENT, refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(MUTATION_EVENT, refresh);
    };
    // `load` is stable per token/org; pathname is the other trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, ready]);

  return (
    <OnboardingContext.Provider value={{ state, ready, refresh: load, settle: setState }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export const useOnboarding = () => useContext(OnboardingContext);
