'use client';

import { useEffect, useRef } from 'react';

/**
 * A poll that stops for a tab nobody is looking at (CMN-29, OPS-43).
 *
 * This is the second time this has been written. `UnreadProvider` had
 * `setInterval(load, 60_000)`, which asked once a minute for as long as a tab
 * existed: 417 polls and about 2,900 database queries over ninety minutes on
 * production, to render a number that changed twice. It was rebuilt to skip
 * hidden tabs and back off — and `HappeningNow`, the only other live thing in
 * the app, kept the original shape, including a 60-second timer that ran on
 * in a tab sitting behind seven others for the rest of the afternoon.
 *
 * So the rules live here instead of in a component:
 *
 *  - **Nothing is scheduled for a hidden tab.** Not throttled, not skipped on
 *    arrival — never scheduled. `visibilitychange` starts it again.
 *  - **Coming back refreshes immediately**, so what the member sees when they
 *    look is current rather than however stale it was when they left.
 *  - **A tick is a background request.** The distinction OPS-09 rests on: a
 *    timer firing into a dead network is the member's circumstances, and a
 *    report of it is noise. The first load is not a tick — somebody has just
 *    opened the screen and is waiting for it — so it is reported.
 *
 * `setTimeout` rather than `setInterval`, chained after each run: an interval
 * cannot be told to stand down for a hidden tab without being cleared anyway,
 * and overlapping runs on a slow connection are a class of bug this avoids by
 * construction.
 */
export function usePoll(
  run: (background: boolean) => Promise<unknown> | void,
  { everyMs, enabled = true }: { everyMs: number; enabled?: boolean },
): void {
  /*
    The callback is read through a ref so the timer does not restart when it
    changes identity.

    Callers build `run` with `useCallback([orgId, token])`, which is a new
    function whenever either moves. With `run` in the effect's dependencies,
    every one of those restarts the timer — and a component that rebuilds the
    callback on each render would never tick at all, because the teardown
    always arrives before the delay elapses. `enabled` and `everyMs` are the
    only things that should start it over.
  */
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  }, [run]);

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // SSR has no `document`. The hook is only used in client components, but
    // one rendered on the server would otherwise throw here rather than
    // simply not polling.
    const watching = () =>
      typeof document === 'undefined' || document.visibilityState !== 'hidden';

    const schedule = () => {
      clearTimeout(timer);
      if (stopped || !watching()) return;
      timer = setTimeout(tick, everyMs);
    };

    const tick = async () => {
      await latest.current(true);
      // The component may have unmounted while the request was in flight, in
      // which case scheduling the next one resurrects a dead timer.
      if (stopped) return;
      schedule();
    };

    const onVisibility = () => {
      if (!watching()) {
        clearTimeout(timer);
        return;
      }
      /*
        Still a background request, even though somebody is now looking.

        They did not ask for this — they switched back to a tab — and a
        failure here is the same "the tab was asleep" case as any other tick.
        What they asked for was the first load, which is reported.
      */
      void tick();
    };

    void Promise.resolve(latest.current(false)).then(() => {
      if (!stopped) schedule();
    });

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, everyMs]);
}
