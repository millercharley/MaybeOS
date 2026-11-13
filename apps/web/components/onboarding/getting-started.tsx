'use client';

import { useState } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { Check, ChevronDown, Sparkles } from 'lucide-react';
import { UnreadBadge } from '@/components/layout/unread-badge';
import { api } from '@/lib/api';
import { checklistIsWorthShowing, stepsStillToDo } from '@/lib/onboarding-checklist';
import { useAuthStore } from '@/lib/auth-store';
import { useOnboarding } from '@/contexts/onboarding-context';

/**
 * The getting-started checklist, as a row in the nav (ONB-01, ONB-02).
 *
 * Charley asked for the sidebar pattern: accordion expansion, an active-task
 * highlight, circular checkboxes and a thin progress bar.
 *
 * **It is a nav row now, not a panel** (Charley, 2026-11-13: "the current
 * widget takes up too much room on mobile"). It used to be pinned between the
 * nav and the account footer, open, costing about a hundred and forty pixels
 * of a column that on a phone is the whole screen. Now it sits directly under
 * Dashboard as one line with a red count on it, and opens when the member
 * asks for it — the same bargain every other section in this nav makes.
 *
 * The count is the badge Messages and the Commons use, deliberately. A member
 * scanning this column should not have to learn a second way of being told
 * there are three of something.
 *
 * **It stops existing when there is nothing left to do.** No congratulation,
 * no "hide this" to press: a finished checklist is not a thing anybody needs
 * to dismiss, and leaving it there with a full progress bar is asking a
 * member to tidy up after the product.
 *
 * **The inner accordion is the other design decision.** Only the active step is open,
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
  /*
    One fetch for the whole signed-in app (ONB-03). This column is mounted
    twice — fixed and drawer — and the dashboard wants the same answer to
    decide whether to say welcome in.
  */
  const { state, ready, settle } = useOnboarding();

  const [busy, setBusy] = useState(false);
  /*
    Shut until asked for (ONB-02), and shut again every time the drawer is
    reopened on a phone — the mobile nav mounts a fresh sidebar each time, so
    this resets on its own, which is the behaviour we want anyway. On a laptop
    the column stays mounted across navigation (NAV-03), so a member who opens
    the checklist keeps it open while they work through it.
  */
  const [open, setOpen] = useState(false);

  /** Only a CUSTOM step is ticked by hand; everything else is derived. */
  async function tick(stepId: string) {
    if (!token || !orgId || busy) return;
    setBusy(true);
    try {
      settle(await api.onboarding.complete(orgId, stepId, token));
    } catch {
      // Not worth an error message in the navigation, and the next
      // navigation re-reads anyway.
    } finally {
      setBusy(false);
    }
  }

  // Nothing until the first answer is in, or the column jumps a beat after
  // it paints.
  if (!ready || !state || !checklistIsWorthShowing(state)) return null;

  const { steps, completed, total, activeStepId } = state;
  const percent = Math.round((completed / total) * 100);
  const remaining = stepsStillToDo(state);

  return (
    <section aria-label="Getting started" className="space-y-1">
      {/* The row. Built to the same measurements as a nav link above it —
          same padding, same 5x5 icon, same badge on the right — because it
          sits in the same list and anything else would read as a visitor. */}
      <button
        type="button"
        onClick={() => setOpen((shown) => !shown)}
        aria-expanded={open}
        aria-controls="getting-started-steps"
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium text-paper-deep transition-colors duration-fast hover:bg-white/10 hover:text-paper"
      >
        <Sparkles className="h-5 w-5 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate">Getting started</span>
        {/* Hidden while open, like the section headers above: the badge
            counts what the row is hiding, and once the steps are on screen
            it is counting something the member can already see. */}
        {!open && <UnreadBadge count={remaining} what="tasks" />}
        <ChevronDown
          className={clsx(
            'h-3.5 w-3.5 shrink-0 transition-transform duration-fast',
            open ? 'rotate-0' : '-rotate-90',
          )}
        />
      </button>

      {open && (
        <div id="getting-started-steps" className="overflow-hidden rounded-lg bg-white/5">
          <header className="px-3 pt-3">
            {/* No heading in here: the row that opened this panel is the
                heading, and repeating "Getting started" two lines below
                itself is the kind of thing that makes a narrow column feel
                narrower. The section's `aria-label` still names it. */}
            <p className="data text-[11px] tabular-nums text-ink-faint">
              {completed} of {total} done
            </p>

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
        </div>
      )}
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
