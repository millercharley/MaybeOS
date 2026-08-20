'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import Link from 'next/link';
import { SUPPORT_EMAIL, supportMailto } from '@/lib/support';
import { RotateCw } from 'lucide-react';

/**
 * Route-level error boundary. Before this existed, a render error anywhere in
 * the app produced Next.js's default screen — a bare "Application error: a
 * client-side exception has occurred" with no way forward and no report sent.
 *
 * Next.js catches the error itself to render this component, which means it
 * never reaches window.onerror. Reporting has to happen here explicitly or it
 * doesn't happen at all.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <div className="card w-full max-w-lg">
        <p className="data mb-3 text-xs uppercase tracking-wider text-[var(--text-tertiary)]">
          Something broke
        </p>

        <h1 className="mb-3 font-display text-2xl leading-tight text-[var(--text-primary)]">
          This page didn&apos;t load
        </h1>

        <p className="mb-6 text-[var(--text-secondary)]">
          The failure has been reported. Trying again often works — the problem
          is frequently a dropped connection rather than the page itself.
        </p>

        <div className="flex flex-wrap gap-3">
          <button onClick={reset} className="btn-primary inline-flex items-center gap-2">
            <RotateCw size={16} aria-hidden="true" />
            Try again
          </button>
          <Link href="/" className="btn-secondary">
            Go home
          </Link>
        </div>

        {/* The address, on the screen where somebody actually needs it
            (PLT-04). "Quote this if you report it" told a co-op to report it
            and not where — and MaybeOS cannot look inside their account to
            find out for them, so the screenshot is the whole mechanism. */}
        <p className="mt-6 border-t border-[var(--border)] pt-4 text-xs text-[var(--text-tertiary)]">
          Still stuck? Send us a screenshot of this page at{' '}
          <a href={supportMailto(undefined, 'This page didn’t load')} className="underline">
            {SUPPORT_EMAIL}
          </a>
          .
          {error.digest && (
            <>
              {' '}Include reference <span className="data">{error.digest}</span>.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
