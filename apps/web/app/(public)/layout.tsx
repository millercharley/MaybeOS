import Link from 'next/link';

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
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
                <span className="text-sm font-bold text-white">M</span>
              </div>
              <span className="text-lg font-semibold text-gray-900">MaybeOS</span>
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
            <Link href="/register" className="btn-primary">
              Join
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
