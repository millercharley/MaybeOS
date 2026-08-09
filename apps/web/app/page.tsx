import Link from 'next/link';
import {
  Landmark,
  Users,
  Calendar,
  DoorOpen,
  MessageSquare,
  BarChart3,
} from 'lucide-react';
import { Wordmark } from '@/components/brand/wordmark';

/**
 * The six tools, named plainly. Descriptions say what the thing does and who
 * it's for — no hype adjectives, no "unlock your potential."
 */
const tools = [
  {
    name: 'Organization Management Tools',
    description:
      'Locations, roles, and who gets to decide what. Governance that matches how your co-op actually runs, not how a software vendor assumed it would.',
    Icon: Landmark,
  },
  {
    name: 'Member Management Tools',
    description:
      'Tiers, dues, and a directory your members control. Sliding scale and pay-what-you-can are built in — not workarounds you have to fight the software for.',
    Icon: Users,
  },
  {
    name: 'Event Management Tools',
    description:
      'Post an event, take RSVPs, run a waitlist. Public pages and calendar feeds, without a ticketing platform skimming a cut off the top.',
    Icon: Calendar,
  },
  {
    name: 'Space Management Tools',
    description:
      'Book rooms, set availability, catch double-bookings before they happen. Your space, scheduled by the people who use it.',
    Icon: DoorOpen,
  },
  {
    name: 'Community Management Tools',
    description:
      'Channels, threads, proposals, and votes in one place — so the conversation and the decision it leads to do not live in two different apps.',
    Icon: MessageSquare,
  },
  {
    name: 'Impact Tracking Tools',
    description:
      'Measure belonging, not engagement. Surveys and dashboards that answer to your members and your funders, and export when you need them to.',
    Icon: BarChart3,
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-paper">
      {/* ── Masthead ─────────────────────────────────────────── */}
      <header className="border-b-[1.5px] border-ink">
        <div className="mx-auto flex max-w-container items-center justify-between px-6 py-5">
          <Wordmark height={28} />
          <nav className="flex shrink-0 items-center gap-2 sm:gap-3">
            <Link href="/login" className="btn-ghost whitespace-nowrap px-3">
              Sign In
            </Link>
            <Link href="/register" className="btn-primary whitespace-nowrap px-3 text-xs sm:px-5 sm:text-sm">
              Create Organization
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="border-b-[1.5px] border-ink">
        <div className="mx-auto max-w-container px-6 py-20 md:py-28">
          <p className="data mb-6 text-xs uppercase tracking-[0.12em] text-ink-soft">
            Open source · Built by a cooperative
          </p>

          <h1 className="max-w-4xl text-balance font-display text-2xl leading-tight text-ink sm:text-3xl lg:text-4xl">
            Your community shouldn&rsquo;t need six vendors and a budget.
          </h1>

          <p className="mt-7 max-w-2xl text-md leading-normal text-ink-soft">
            Most co-ops run on duct tape — a mailing list here, a ticketing site
            there, a chat app, a booking calendar, a survey tool. Each one priced
            per seat, for companies. MaybeOS puts all of it in one suite, sized
            for a community instead of a corporation.
          </p>

          <p className="mt-4 max-w-2xl text-md leading-normal text-ink">
            Run your co-op, not your software stack.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link href="/register" className="btn-primary px-7 py-3 text-base">
              Create Organization
            </Link>
            <Link href="/login" className="btn-secondary px-7 py-3 text-base">
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* ── The six tools ────────────────────────────────────── */}
      <section className="border-b-[1.5px] border-ink">
        <div className="mx-auto max-w-container px-6 py-20">
          <div className="mb-12 flex flex-wrap items-end justify-between gap-4">
            <h2 className="font-display text-xl text-ink sm:text-2xl">
              Six tools. One suite. No per-seat tax.
            </h2>
            <p className="data text-xs uppercase tracking-[0.12em] text-ink-faint">
              All included
            </p>
          </div>

          <div className="grid gap-7 md:grid-cols-2 lg:grid-cols-3">
            {tools.map(({ name, description, Icon }) => (
              <article key={name} className="card flex flex-col">
                <Icon
                  className="mb-5 h-6 w-6 text-brand-600"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <h3 className="mb-2 text-base font-semibold leading-snug text-ink">
                  {name}
                </h3>
                <p className="text-sm leading-normal text-ink-soft">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Manifesto: the one ink field on the page ─────────── */}
      <section className="bg-ink">
        <div className="mx-auto max-w-container px-6 py-20 md:py-24">
          <div className="max-w-3xl">
            <p className="data mb-6 text-xs uppercase tracking-[0.12em] text-paper-deep">
              Why this exists
            </p>

            <h2 className="text-balance font-display text-xl leading-tight text-paper sm:text-2xl lg:text-3xl">
              The tools to organize should belong to the people organizing.
            </h2>

            <div className="mt-8 space-y-5 text-md leading-normal text-paper-dim">
              <p>
                Community software got built for companies with procurement
                departments. The pricing assumes headcount. The features assume a
                manager. The contract assumes a lawyer. None of that describes a
                tool library, a housing co-op, or a converted warehouse that runs
                on volunteer shifts.
              </p>
              <p>
                MaybeItsFate is a cooperative. We built this because we needed it
                and could not afford the alternative. It is open source, so you
                can read every line, host it yourself, fork it, or let us run it
                for you. Leaving is always possible — which is the point.
              </p>
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link
                href="/register"
                className="btn-secondary px-7 py-3 text-base"
              >
                Create Organization
              </Link>
              <a
                href="https://github.com/millercharley/MaybeOS"
                target="_blank"
                rel="noreferrer"
                className="data text-sm text-paper-deep underline underline-offset-4 hover:text-paper"
              >
                Read the source
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t-[1.5px] border-ink">
        <div className="mx-auto flex max-w-container flex-wrap items-center justify-between gap-4 px-6 py-10">
          <Wordmark height={22} />
          <p className="data text-xs text-ink-faint">
            Built by a co-op, for co-ops · {new Date().getFullYear()}
          </p>
        </div>
      </footer>
    </div>
  );
}
