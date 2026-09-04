'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import { api, MUTATION_EVENT, OnboardingState } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * The getting-started checklist, in the left nav (ONB-01).
 *
 * Charley asked for the sidebar pattern: a permanent fixture of the workspace
 * rather than a temporary overlay, with accordion expansion, an active-task
 * highlight, circular checkboxes and a thin progress bar.
 *
 * **It lives outside the scrolling nav.** That is what makes it persistent
 * rather than merely present: an organiser's navigation is twenty links, and a
 * checklist that scrolls away with them is a checklist somebody meets once.
 * Sitting between the nav and the account footer, it is on screen at every
 * scroll position without ever covering anything.
 *
 * **The accordion is the design decision.** Only the active step is open,
 * showing its description and its button; everything else is one line. That is
 * what keeps five tasks to about a hundred and forty pixels — and what stops
 * the list reading as a wall of homework. Nothing here is clickable-to-expand:
 * the open step is always the first one not done, so the list cannot be left
 * in a state that disagrees with the progress bar.
 *
 * **Styled for this sidebar, not for the reference.** The example is a white
 * card; MaybeOS's nav is dark ink with paper type, and a white card dropped
 * into it would read as a foreign object. So the same anatomy is rebuilt in
 * the nav's own palette: brand red for what is done and for the button, the
 * ink's own white/10 wash for the active row, and paper at three weights to
 * separate done from active from still to come.
 */
export function GettingStarted() {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);
  const pathname = usePathname();

  const [state, setState] = useState<OnboardingState | null>(null);
  const [busy, setBusy] = useState(false);
  // Nothing is drawn until the first answer is in. A checklist that appears a
  // beat after the nav paints makes the whole column jump.
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    if (!token || !orgId) {
      setReady(true);
      return;
    }
    try {
      setState(await api.onboarding.mine(orgId, token));
    } catch {
      // A checklist is not worth an error message in the navigation. If it
      // cannot load, the nav is simply the nav.
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
   * Navigation alone is not enough, and the case that proves it is the obvious
   * one: a member follows "Do it now" to their profile, fills it in, saves,
   * and stays on the page. The step they were sent to do is done and the
   * checklist still says it is not. So this also listens for the api client's
   * mutation announcement, which fires after any successful non-GET request —
   * one hook covering every save in the product rather than a callback wired
   * into each page a step can point at.
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

  if (!ready || !state) return null;

  const { steps, completed, total, activeStepId, allDone } = state;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  async function tick(stepId: string) {
    if (!token || !orgId || busy) return;
    setBusy(true);
    try {
      setState(await api.onboarding.complete(orgId, stepId, token));
    } catch {
      // Same reasoning as above — and the next navigation re-reads anyway.
    } finally {
      setBusy(false);
    }
  }

  async function putAway() {
    if (!token || !orgId || busy) return;
    setBusy(true);
    try {
      await api.onboarding.dismiss(orgId, token);
      setState(null);
    } catch {
      /* left where it was */
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Getting started"
      className="shrink-0 border-t border-white/15 px-3 py-3"
    >
      <div className="overflow-hidden rounded-lg bg-white/5">
        <header className="px-3 pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-paper">Getting started</h2>
            <span className="data text-[11px] tabular-nums text-ink-faint">
              {completed}/{total}
            </span>
          </div>

          {/* The thin bar. Narrow enough to sit under the header without
              competing with the list, present enough that somebody always
              knows roughly how far along they are. */}
          <div
            className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${completed} of ${total} steps done`}
          >
            <div
              className="h-full rounded-full bg-brand-600 transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        </header>

        <ul className="mt-2 pb-1">
          {steps.map((step) => {
            const isActive = step.id === activeStepId;

            return (
              <li
                key={step.id}
                className={clsx(
                  'px-3 transition-colors',
                  // A collapsed row is one line and does not need an open
                  // row's breathing space. Five of them at the open row's
                  // padding is fifty wasted pixels in a column that has none
                  // to spare.
                  isActive ? 'py-2.5' : 'py-1.5',
                  // The active-task highlight. A wash rather than a border, so
                  // the row reads as lifted without adding a second edge to a
                  // column that already has one every 40 pixels.
                  isActive && 'bg-white/10',
                )}
              >
                <div className="flex items-start gap-2.5">
                  <Circle done={step.done} active={isActive} />

                  <div className="min-w-0 flex-1">
                    <p
                      className={clsx(
                        'text-sm leading-snug',
                        step.done
                          ? 'font-medium text-ink-faint line-through decoration-ink-faint/50'
                          : isActive
                            ? 'font-semibold text-paper'
                            : 'font-medium text-paper-deep/45',
                      )}
                    >
                      {step.title}
                    </p>

                    {/* Only the active step says more than its name. */}
                    {isActive && (
                      <>
                        {step.description && (
                          <p className="mt-1 text-xs leading-relaxed text-paper-deep/70">
                            {step.description}
                          </p>
                        )}

                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          {step.href && (
                            <Link
                              href={step.href}
                              className="inline-flex items-center rounded-md bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700"
                            >
                              {step.ctaLabel}
                            </Link>
                          )}
                          {/* Only a custom step is ticked by hand. Everything
                              else is derived, so a "mark done" on it would be
                              a button that un-does itself on the next read. */}
                          {step.selfMarked && (
                            <button
                              type="button"
                              onClick={() => tick(step.id)}
                              disabled={busy}
                              className="text-xs font-medium text-ink-faint transition-colors hover:text-paper-deep disabled:opacity-50"
                            >
                              Mark done
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {allDone && (
          <div className="border-t border-white/10 px-3 py-2.5">
            <p className="text-xs text-paper-deep/70">
              That&rsquo;s everything. Welcome in.
            </p>
            <button
              type="button"
              onClick={putAway}
              disabled={busy}
              className="mt-1.5 text-xs font-medium text-brand-500 transition-colors hover:text-brand-400 disabled:opacity-50"
            >
              Hide this
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * The circular checkbox, in three states.
 *
 * Filled when done, ringed and brightened while active, a faint outline for
 * everything still ahead. The size is fixed and matches the first line of the
 * title, so a two-line title does not drag the circle down with it.
 */
function Circle({ done, active }: { done: boolean; active: boolean }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors',
        done
          ? 'border-brand-600 bg-brand-600'
          : active
            ? 'border-paper-deep/60'
            : 'border-white/20',
      )}
    >
      {done && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
    </span>
  );
}
