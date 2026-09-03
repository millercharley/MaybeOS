import Link from 'next/link';
import { Wordmark } from '@/components/brand/wordmark';

/**
 * The shell for /privacy and /terms.
 *
 * These sit outside the `(public)` layout deliberately: that layout is the
 * chrome for a co-op's public pages — its events, its portal — and wrapping
 * MaybeOS's own legal documents in it would present them as belonging to
 * whichever co-op you had just been looking at. These are MaybeOS speaking as
 * itself, so they carry the landing page's chrome instead.
 */
export function LegalPage({
  title,
  updated,
  summary,
  children,
}: {
  title: string;
  updated: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b-[1.5px] border-ink">
        <div className="mx-auto flex flex-wrap max-w-container items-center justify-between px-6 py-6 gap-3">
          <Link href="/" aria-label="MaybeOS home">
            <Wordmark height={22} />
          </Link>
          <Link href="/" className="data text-xs text-ink-faint hover:text-ink">
            ← Back
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-14">
        <h1 className="font-display text-2xl leading-tight text-ink">{title}</h1>
        <p className="data mt-2 text-xs text-ink-faint">Last updated {updated}</p>
        <p className="mt-6 border-l-2 border-ink pl-4 text-lg leading-relaxed text-ink">
          {summary}
        </p>

        <div className="legal mt-10 space-y-8 text-[15px] leading-relaxed text-ink">
          {children}
        </div>
      </main>

      <footer className="border-t-[1.5px] border-ink">
        <div className="mx-auto flex max-w-container flex-wrap items-center justify-between gap-4 px-6 py-10">
          <Wordmark height={22} />
          <div className="data flex items-center gap-5 text-xs text-ink-faint">
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
            <Link href="/terms" className="hover:text-ink">Terms</Link>
            <span>Built by a co-op, for co-ops · {new Date().getFullYear()}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** A titled section. Kept here so both documents look identical. */
export function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-ink">{heading}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}
