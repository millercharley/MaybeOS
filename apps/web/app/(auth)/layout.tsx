import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        {/* Branding */}
        <div className="text-center">
          <Link href="/" className="inline-block">
            <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">
              MaybeOS
            </h1>
          </Link>
          <p className="mt-2 text-sm text-gray-500">
            Community-powered platform for cooperative organizations
          </p>
        </div>

        {/* Card container */}
        <div className="card rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
