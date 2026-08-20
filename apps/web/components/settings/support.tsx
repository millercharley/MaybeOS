'use client';

import { LifeBuoy, Mail } from 'lucide-react';
import { SUPPORT_EMAIL, supportMailto } from '@/lib/support';

/**
 * Where to write when something is wrong (PLT-04).
 *
 * Shown to organisers, because they are the people who hit a broken screen
 * and have nobody to tell. It says to send a screenshot, and it says **why
 * that is what we ask for** — a co-op that knows MaybeOS cannot look inside
 * its account is a co-op that understands why it is being asked to describe
 * the problem rather than hand over access.
 */
export function Support({ orgName }: { orgName?: string }) {
  return (
    <section className="card max-w-2xl space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          <LifeBuoy className="h-4 w-4 text-gray-400" />
          Getting help
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Something not working, or not making sense? Write to us with a screenshot and what you
          were trying to do.
        </p>
      </div>

      <a href={supportMailto(orgName)} className="btn-primary inline-flex items-center gap-2 text-sm">
        <Mail className="h-4 w-4" />
        {SUPPORT_EMAIL}
      </a>

      <p className="border-t border-gray-100 pt-3 text-xs text-gray-500">
        {/* The reason, not just the instruction. It is the same promise the
            member-facing pages make, seen from the co-op's side. */}
        We ask for a screenshot because <b>MaybeOS cannot look inside your co-op</b>. Nobody here
        can read your member list, your messages or your members&apos; answers — not to help, and
        not for any other reason. If we ever change something on your account you&apos;ll see it in
        your own audit log.
      </p>
    </section>
  );
}
