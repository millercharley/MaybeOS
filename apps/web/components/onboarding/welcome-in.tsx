'use client';

import { useState } from 'react';
import { PartyPopper, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useOnboarding } from '@/contexts/onboarding-context';
import { welcomeIsDue } from '@/lib/onboarding-checklist';

/**
 * "That's everything. Welcome in." (ONB-03)
 *
 * The checklist used to carry this itself, at the bottom of the panel in the
 * nav, beside a "Hide this" button. Then the checklist was moved into a row
 * that disappears the moment the last box is ticked (ONB-02) — which was the
 * right call for a narrow column and took the one moment the product said
 * well done with it. A member finished and the row simply vanished.
 *
 * So it moved here, where there is room for it: the top of the member's own
 * dashboard, the page they are most likely to be on when the last step lands,
 * and the one screen in the product that is about them rather than about a
 * task.
 *
 * **This is what dismissal is for now.** `POST onboarding/me/dismiss` is
 * refused by the API while anything is left undone, so it can only ever mean
 * "I have read the congratulation", and the server answers `null` to every
 * later read — which takes this away permanently and keeps the nav row away
 * with it. One record, two surfaces, no second flag to get out of step.
 *
 * It is shown once per member, ever. Somebody who satisfied all five steps
 * years before this existed meets it on their next visit and closes it, which
 * is a fair reading of "welcome in" rather than a wrong one.
 */
export function WelcomeIn() {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);
  const { state, ready, settle } = useOnboarding();
  const [busy, setBusy] = useState(false);

  // `state` is already null for a co-op with no checklist, and for anybody
  // who has put it away. All that is left to ask is whether they finished.
  if (!ready || !welcomeIsDue(state)) return null;

  async function close() {
    if (!token || !orgId || busy) return;
    setBusy(true);
    /*
      Taken off the screen first, and kept off even if the request fails.
      This is an acknowledgement, not a record: a member who presses the ✕ and
      watches it stay put will press it again, and the worst case of a failed
      write is meeting it once more on the next visit.
    */
    settle(null);
    try {
      await api.onboarding.dismiss(orgId, token);
    } catch {
      // See above.
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="relative overflow-hidden rounded-xl border border-brand-200 bg-brand-50 p-4">
      <div className="flex items-start gap-3">
        <PartyPopper className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-gray-900">
            That&rsquo;s everything. Welcome in.
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            You&rsquo;ve finished getting started — the checklist is done and gone.
          </p>
        </div>

        <button
          type="button"
          onClick={close}
          disabled={busy}
          aria-label="Dismiss"
          className="shrink-0 rounded p-1 text-brand-700/60 transition-colors hover:bg-white hover:text-brand-700 disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
