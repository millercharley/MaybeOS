import Link from 'next/link';

const modules = [
  {
    name: 'OrgOS',
    description: 'Manage your cooperative structure, roles, and governance settings in one place.',
    icon: '\u{1F3DB}',
  },
  {
    name: 'MemberOS',
    description: 'Membership tiers, onboarding flows, and member directories for your community.',
    icon: '\u{1F465}',
  },
  {
    name: 'EventsOS',
    description: 'Create, schedule, and manage events with RSVPs, calendars, and public listings.',
    icon: '\u{1F4C5}',
  },
  {
    name: 'SpaceOS',
    description: 'Book rooms, manage shared spaces, and coordinate physical resources.',
    icon: '\u{1F3E2}',
  },
  {
    name: 'CommonsOS',
    description: 'Discussion channels, proposals, and democratic decision-making tools.',
    icon: '\u{1F4AC}',
  },
  {
    name: 'ImpactOS',
    description: 'Surveys, impact dashboards, and metrics to measure community well-being.',
    icon: '\u{1F4CA}',
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Hero Section */}
      <section className="px-4 py-24 text-center sm:px-6 lg:px-8">
        <h1 className="text-5xl font-extrabold tracking-tight text-gray-900 sm:text-6xl">
          MaybeOS Suite
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-xl text-gray-600">
          A community-powered platform for cooperative organizations. Manage members,
          host events, share spaces, make decisions together, and measure your impact
          &mdash; all in one place.
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/login"
            className="btn-primary inline-block rounded-lg px-8 py-3 text-lg font-semibold"
          >
            Sign In
          </Link>
          <Link
            href="/register"
            className="btn-secondary inline-block rounded-lg px-8 py-3 text-lg font-semibold"
          >
            Create Organization
          </Link>
          <Link
            href="/events"
            className="inline-block rounded-lg border border-gray-300 bg-white px-8 py-3 text-lg font-semibold text-gray-700 hover:bg-gray-50"
          >
            Browse Events
          </Link>
        </div>
      </section>

      {/* Features Grid */}
      <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-6 lg:px-8">
        <h2 className="mb-12 text-center text-3xl font-bold text-gray-900">
          Everything Your Organization Needs
        </h2>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((mod) => (
            <div
              key={mod.name}
              className="card rounded-xl border border-gray-200 bg-white p-8 shadow-sm transition hover:shadow-md"
            >
              <div className="mb-4 text-4xl">{mod.icon}</div>
              <h3 className="mb-2 text-xl font-semibold text-gray-900">{mod.name}</h3>
              <p className="text-gray-600">{mod.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-gray-50 px-4 py-12 text-center text-sm text-gray-500">
        <p>&copy; {new Date().getFullYear()} MaybeOS. Built for cooperatives, by cooperatives.</p>
      </footer>
    </div>
  );
}
