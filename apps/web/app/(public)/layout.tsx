import Link from 'next/link';
import { Wordmark } from '@/components/brand/wordmark';

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-8">
            {/*
              The wordmark asset, never a hand-drawn substitute. This header
              used to draw an "M" in a rounded square next to the name in a
              system font, so the same site showed two different logos
              depending on which page you were on — this one on /events and
              /orgs/[slug], the real mark on the landing page.
            */}
            <Link href="/" className="flex items-center">
              <Wordmark height={26} />
            </Link>

            <nav className="hidden sm:flex items-center gap-6">
              <Link
                href="/events"
                className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                Events
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/login" className="btn-secondary">
              Sign In
            </Link>
            {/*
              Labelled for where it actually goes. This said "Join", and
              /register founds a *new* co-op — so on a co-op's own public page
              the header invited you to join and then offered to start a
              different organisation, which is the exact confusion D-020 was
              written about.

              It deliberately does not offer to join the co-op you are looking
              at. That belongs to the tier buttons on /orgs/[slug], which know
              which tier was chosen and whether the co-op accepts public
              joiners at all (MEM-03). A second join path in the header would
              know neither, and would drift from the first.

              "Create Organization" matches the landing page, which already
              uses that label for this destination in all three of its CTAs.
            */}
            <Link href="/register" className="btn-primary">
              Create Organization
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
        <p>&copy; {new Date().getFullYear()} MaybeOS. Built for cooperatives, by cooperatives.</p>
      </footer>
    </div>
  );
}
