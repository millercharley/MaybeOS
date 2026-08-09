import Link from 'next/link';
import { Wordmark } from '@/components/brand/wordmark';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        {/* Branding */}
        <div className="text-center">
          <Link href="/" className="inline-block">
            <Wordmark height={34} className="mx-auto" />
          </Link>
          <p className="mt-3 text-sm text-ink-soft">
            Run your co-op, not your software stack.
          </p>
        </div>

        {/* Card container — .card already carries the brand's ink border and
            hard offset shadow, so no local border/shadow overrides here. */}
        <div className="card p-8">{children}</div>
      </div>
    </div>
  );
}
