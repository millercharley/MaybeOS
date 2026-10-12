'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { KeyRound, X } from 'lucide-react';
import { readPrompt, settlePrompt } from '@/lib/password-prompt';

/**
 * "You can add a password", said once, just after a sign-in link (AUTH-05).
 *
 * AUTH-04 made creating one possible; almost nobody would have found it.
 * Profile settings serves people who already suspect the option exists, and
 * 433 of MaybeItsFate's 439 members sign in with a link — so the offer has
 * to come to them, at the one moment it is obviously useful: they have just
 * been to their inbox to get in.
 *
 * **Dismissible and never blocking**, because a sign-in link is a complete
 * way to use MaybeOS rather than a lesser one. Declining is permanent, so
 * somebody who signs in by link every week is asked once, not weekly.
 */
export function PasswordOffer({ profileHref }: { profileHref: string | null }) {
  /*
    Read in an effect, not during render. localStorage does not exist on the
    server, and reading it while rendering makes the first client paint
    disagree with the markup that came from the server.
  */
  const [show, setShow] = useState(false);
  useEffect(() => setShow(readPrompt() === 'offer'), []);

  if (!show || !profileHref) return null;

  function close() {
    settlePrompt();
    setShow(false);
  }

  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm">
      <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-gray-900">Want a password?</p>
        <p className="mt-0.5 text-gray-600">
          You signed in with a link. Add a password and you can use either — the link keeps
          working.
        </p>
        <Link
          href={profileHref}
          onClick={close}
          className="mt-2 inline-block font-medium text-brand-700 underline"
        >
          Create a password
        </Link>
      </div>
      <button
        type="button"
        onClick={close}
        aria-label="Not now"
        className="shrink-0 rounded p-1 text-gray-400 hover:bg-white hover:text-gray-700"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
