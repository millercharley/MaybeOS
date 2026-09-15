import Link from 'next/link';
import {
  ArrowRight,
  CreditCard,
  FileSpreadsheet,
  ScanSearch,
  BarChart3,
  CalendarDays,
  Check,
  DoorOpen,
  Globe,
  HandHeart,
  Hash,
  KeyRound,
  MessagesSquare,
  Users,
  Wrench,
} from 'lucide-react';
import { Wordmark } from '@/components/brand/wordmark';
import { SUPPORT_EMAIL, supportMailto } from '@/lib/support';
import { Reveal } from '@/components/landing/reveal';
import { RotatingWord } from '@/components/landing/rotating-word';
import { HeroScene } from '@/components/landing/hero-scene';
import { RetireTicker } from '@/components/landing/retire-ticker';
import { PricingPlans } from '@/components/landing/pricing-plans';
import { WeekTimeline, type WeekStep } from '@/components/landing/week-timeline';
import styles from '@/components/landing/landing.module.css';

/**
 * The public landing page (WEB-02).
 *
 * Every claim here is something the product does today, checked against the
 * code on 2026-09-15: the prices come from `maybeos-plans.ts` and
 * `ticket-pricing.ts`, and features that are still rolling out say so. The
 * people in the illustrations are made up; the features are not.
 */

const SOURCE_URL = 'https://github.com/millercharley/MaybeOS';

const ROTATING = [
  'members',
  'events',
  'ticketing',
  'rooms',
  'dues',
  'decisions',
  'handbook',
  'front door',
  'community',
];

const DUCT_TAPE = [
  'the member spreadsheet',
  'the ticketing site',
  'the group chat',
  'the room-booking calendar',
  'the dues spreadsheet',
  'the door-code sheet',
  'the annual survey',
  'the volunteer rota',
];

const WEEK: WeekStep[] = [
  {
    day: 'Monday',
    title: 'Someone new joins',
    body: 'They find your join page from your website, choose a tier, and pay their dues straight into your co-op’s own Stripe account.',
    points: [
      'Pay-what-you-can tiers, with a minimum you set',
      'A getting-started checklist that ticks itself off',
      'A buddy to show them around',
      'Their door code, by email',
    ],
    aside: (
      <div className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between">
          <p className="font-display text-lg text-ink">Getting started</p>
          <span className="font-mono text-xs text-ink-faint">3 of 4</span>
        </div>
        {['Fill in your profile', 'Say hello in #general', 'RSVP to something', 'Meet your buddy'].map((step, i) => (
          <div key={step} className="flex items-center gap-3 text-sm">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] border-ink ${i < 3 ? 'bg-moss text-paper' : 'bg-white'}`}
            >
              {i < 3 && <Check className="h-3 w-3" />}
            </span>
            <span className={i < 3 ? 'text-ink-faint line-through' : 'text-ink'}>{step}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    day: 'Tuesday',
    title: 'A member puts something on',
    body: 'Any member can host. Add a picture, make it public or members-only, publish, and the word gets out on its own.',
    points: [
      'Posted to #events in the Commons automatically',
      'Shared to your Facebook Page and Instagram, credited to the host (rolling out)',
      'Paid tickets with a flat fee, never a percentage',
      'Calendar feeds and an embed for your own website',
    ],
    aside: (
      <div className="card p-5">
        <div className="flex items-center gap-2 text-xs text-ink-faint">
          <Hash className="h-3.5 w-3.5" /> events
        </div>
        <p className="mt-2 text-sm text-ink">
          <strong>Rosa</strong> is hosting <strong>Figure drawing night</strong>
        </p>
        <p className="text-xs text-ink-soft">Thursday at 7:00 pm · Studio B · Public</p>
        <div className="mt-4 rounded-md border border-ink/15 bg-paper p-3 text-xs text-ink-soft">
          Hosted by @rosa.draws
          <br />
          RSVP: maybeos.org/portal/…/figure-drawing-night
        </div>
      </div>
    ),
  },
  {
    day: 'Thursday',
    title: 'The doors open',
    body: 'The host runs the door from their phone: check people in, add walk-ins, and see who actually came.',
    points: ['RSVPs with a waitlist', 'Check-in and walk-ins', 'The host’s share of ticket sales worked out for you'],
    aside: (
      <div className="card divide-y divide-ink/10 p-0">
        {[
          ['Amara K.', 'Checked in'],
          ['Jonah T.', 'Checked in'],
          ['Walk-in', 'Added at the door'],
          ['Dee L.', 'Going'],
        ].map(([name, state]) => (
          <div key={name} className="flex flex-wrap items-center justify-between px-5 py-3 text-sm">
            <span className="text-ink">{name}</span>
            <span className={`font-mono text-xs ${state === 'Going' ? 'text-ink-faint' : 'text-moss'}`}>{state}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    day: 'Saturday',
    title: 'The space gets used',
    body: 'Members book rooms inside the hours you set, and a double booking is caught before it happens rather than at the door.',
    points: [
      'Opening hours, blackout dates and building closures',
      'Rooms can connect to Google Calendar',
      'Paid room hire, on the same flat fee',
      'A briefing emailed to whoever is hosting that day',
    ],
    aside: (
      <div className="card p-5">
        <p className="font-display text-lg text-ink">Studio B · Saturday</p>
        <div className="mt-3 space-y-2 text-xs">
          <div className="rounded-md border-[1.5px] border-ink bg-moss-tint px-3 py-2 text-ink">10:00 – 12:00 · Ceramics open studio</div>
          <div className="rounded-md border-[1.5px] border-dashed border-brand-600 bg-brand-50 px-3 py-2 text-brand-700">
            11:00 – 13:00 · Overlaps with Ceramics. Pick another time.
          </div>
          <div className="rounded-md border-[1.5px] border-ink bg-mustard-tint px-3 py-2 text-ink">14:00 – 17:00 · Zine swap</div>
        </div>
      </div>
    ),
  },
  {
    day: 'All year',
    title: 'Decide together, and show what it added up to',
    body: 'Talk it through in channels, put proposals to a vote, and ask members one short question a month at most. At the end of the year, publish an impact report at a link you can send a funder.',
    points: [
      'Channels, sections, threads and direct messages',
      'Proposals and votes, next to the conversation',
      'Answers only ever shown in groups, never one person’s',
      'Volunteer hours valued in dollars',
    ],
    aside: (
      <div className="card p-5">
        <p className="text-xs uppercase tracking-widest text-ink-faint">Proposal</p>
        <p className="mt-1 font-display text-lg leading-tight text-ink">Open the workshop on Sunday mornings</p>
        <div className="mt-4 space-y-2">
          {[
            ['Yes', 72, 'bg-moss'],
            ['No', 18, 'bg-brand-600'],
            ['Abstain', 10, 'bg-ink-faint'],
          ].map(([label, pct, color]) => (
            <div key={label as string}>
              <div className="flex flex-wrap justify-between text-xs text-ink-soft">
                <span>{label}</span>
                <span className="font-mono">{pct}%</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-paper-deep">
                <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
];

const FEATURES = [
  {
    Icon: Users,
    name: 'Members and dues',
    body: 'Tiers with pay what you can, dues on your own Stripe account, invitations and imports, and a directory that keeps contact details between members and organisers.',
  },
  {
    Icon: CalendarDays,
    name: 'Events and tickets',
    body: 'Public or members-only events, RSVPs and waitlists, paid tickets, a door list for check-in, and the host’s share worked out.',
  },
  {
    Icon: DoorOpen,
    name: 'Rooms and space',
    body: 'Bookable hours, blackout dates, conflict checks, paid room hire and Google Calendar sync, room by room.',
  },
  {
    Icon: MessagesSquare,
    name: 'The Commons',
    body: 'Channels filed under sections, threads, direct messages, @mentions, and proposals you can vote on, all in one place.',
  },
  {
    Icon: KeyRound,
    name: 'Door access',
    body: 'A five-letter door code for every member, kept in step with your door’s sheet and revoked when a membership is cancelled.',
  },
  {
    Icon: HandHeart,
    name: 'Belonging',
    body: 'Buddy pairing for new members, a handbook with required reading, and a getting-started checklist you write.',
  },
  {
    Icon: Wrench,
    name: 'Volunteering',
    body: 'A rota members sign up to, hours counted against what you ask of them, and briefings for whoever is hosting.',
  },
  {
    Icon: BarChart3,
    name: 'Impact',
    body: 'Your mission and goals, one short question a month at most, expenses, and a year-end report at a public link.',
  },
  {
    Icon: Globe,
    name: 'Your website',
    body: 'A public page and join page for your community, embeds for events and membership, and calendar feeds.',
  },
];

const MIGRATION = [
  {
    Icon: CreditCard,
    title: 'Keep your Stripe subscriptions',
    body: 'Link the Stripe account you already use. MaybeOS finds the members already paying you, matches them by email, and puts each one on the tier you pair with their price. Their subscriptions keep billing exactly as before: nobody re-enters a card or signs up again.',
  },
  {
    Icon: FileSpreadsheet,
    title: 'Import your member list',
    body: 'Upload a spreadsheet from wherever your members are now. Say what each column means, including join dates, bios, tags and profile photos, then read every row before anything is saved.',
  },
  {
    Icon: ScanSearch,
    title: 'See it before it happens',
    body: 'Adopting subscriptions starts with a preview: who matches, who is new, and whether the dues MaybeOS will record add up to what Stripe is actually collecting. If you issue member shares, your cap table comes across too.',
  },
];

/** Illustration only: made-up addresses, showing the adoption preview's outcomes. */
const MATCHES = [
  { email: 'priya@…', tier: 'Supporter', outcome: 'Matched' },
  { email: 'jonah.t@…', tier: 'Studio member', outcome: 'Matched' },
  { email: 'amara.k@…', tier: 'Supporter', outcome: 'New member' },
  { email: 'dee@…', tier: 'Pay what you can', outcome: 'Matched' },
];

export default function HomePage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-paper text-ink">
      {/* ── Masthead ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b-[1.5px] border-ink bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-container flex-wrap items-center justify-between gap-4 px-6 py-4">
          <Link href="/" aria-label="MaybeOS home">
            <Wordmark height={28} />
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-medium text-ink-soft md:flex" aria-label="Page sections">
            <a href="#week" className="hover:text-ink">How it works</a>
            <a href="#features" className="hover:text-ink">Features</a>
            <a href="#switching" className="hover:text-ink">Switching</a>
            <a href="#pricing" className="hover:text-ink">Pricing</a>
            <a href={SOURCE_URL} className="hover:text-ink">Open source</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn-ghost text-sm">
              Sign in
            </Link>
            <Link href="/register" className="btn-primary text-sm">
              Start free
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ── Hero ───────────────────────────────────────────── */}
        <section className="relative">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage: 'radial-gradient(#C4B89D 1px, transparent 1px)',
              backgroundSize: '22px 22px',
              maskImage: 'linear-gradient(to bottom, black, transparent 85%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black, transparent 85%)',
            }}
            aria-hidden="true"
          />
          <div className="relative mx-auto grid max-w-container items-center gap-14 px-6 pb-20 pt-14 md:pt-20 xl:grid-cols-[1.05fr_1fr] xl:gap-10 xl:pb-28">
            <div>
              <p className={`${styles.enter} font-mono text-xs uppercase tracking-[0.2em] text-ink-soft`}>
                Open source · for member-run communities
              </p>
              <h1
                className={`${styles.enter} mt-5 font-display text-3xl leading-[1.05] text-ink sm:text-4xl xl:text-5xl`}
                style={{ ['--delay' as string]: '100ms' }}
              >
                <span className="sr-only">One place for your whole community.</span>
                <span aria-hidden="true">
                  One place for your{' '}
                  <span className="relative inline-block">
                    <RotatingWord words={ROTATING} />
                    <svg
                      className={`${styles.underline} absolute -bottom-2 left-0 h-3 w-full text-brand-600`}
                      viewBox="0 0 200 12"
                      preserveAspectRatio="none"
                    >
                      <path d="M2 8 C 50 2, 120 12, 198 5" pathLength={1} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  </span>
                </span>
              </h1>
              <p
                className={`${styles.enter} mt-7 max-w-xl text-md leading-relaxed text-ink-soft`}
                style={{ ['--delay' as string]: '250ms' }}
              >
                MaybeOS runs the everyday work of a co-op, makerspace, club or shared space: who’s a member, what’s on,
                who has the room, what you decided, and who can open the door. One suite that works together, instead of
                a stack of apps held together with tape.
              </p>
              <div
                className={`${styles.enter} mt-9 flex flex-wrap items-center gap-3`}
                style={{ ['--delay' as string]: '400ms' }}
              >
                <Link href="/register" className="btn-primary group px-6 py-3 text-base">
                  Start free
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <a href="#week" className="btn-secondary px-6 py-3 text-base">
                  See a week on MaybeOS
                </a>
              </div>
              <p
                className={`${styles.enter} mt-5 text-sm text-ink-faint`}
                style={{ ['--delay' as string]: '500ms' }}
              >
                Free plan. No features locked behind a plan. Apache 2.0 licensed.
              </p>
            </div>

            <HeroScene />
          </div>
        </section>

        {/* ── The duct tape it replaces ──────────────────────── */}
        <section className="border-y-[1.5px] border-ink bg-ink py-5 text-paper" aria-label="What MaybeOS replaces">
          <RetireTicker items={DUCT_TAPE} />
        </section>

        {/* ── A week on MaybeOS ──────────────────────────────── */}
        <section id="week" className="scroll-mt-20 py-24 md:py-32">
          <div className="mx-auto max-w-container px-6">
            <Reveal className="mx-auto max-w-2xl text-center">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-brand-600">How it works</p>
              <h2 className="mt-4 font-display text-2xl leading-tight text-ink md:text-3xl">A week in a community running on MaybeOS</h2>
              <p className="mt-5 text-md text-ink-soft">
                Not six tools with logins of their own. One place where joining, hosting, booking and deciding already
                know about each other.
              </p>
            </Reveal>
            <div className="mt-20">
              <WeekTimeline steps={WEEK} />
            </div>
          </div>
        </section>

        {/* ── Everything included ────────────────────────────── */}
        <section id="features" className="scroll-mt-20 border-t-[1.5px] border-ink bg-paper-dim py-24 md:py-32">
          <div className="mx-auto max-w-container px-6">
            <Reveal className="max-w-2xl">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-brand-600">Everything included</p>
              <h2 className="mt-4 font-display text-2xl leading-tight text-ink md:text-3xl">
                What a member-run community actually runs on
              </h2>
              <p className="mt-5 text-md text-ink-soft">
                Every plan gets all of it. Use what you need now, and the rest is there when you do.
              </p>
            </Reveal>

            <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ Icon, name, body }, i) => (
                <Reveal key={name} delay={(i % 3) * 90}>
                  <article className={`${styles.lift} card h-full p-6`}>
                    <span className="flex h-11 w-11 items-center justify-center rounded-md border-[1.5px] border-ink bg-paper">
                      <Icon className="h-5 w-5 text-brand-600" />
                    </span>
                    <h3 className="mt-5 font-display text-lg text-ink">{name}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-ink-soft">{body}</p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── Switching (MIG-01/02, MEM-06) ────────────────────── */}
        {/*
          Verified 2026-09-15: adoption reads the co-op's own connected Stripe
          account, matches subscriptions to members by email (creating the
          member when needed) and writes nothing to Stripe. Only subscriptions
          on the community's own account can be adopted, which is why the copy
          says "your own Stripe account".
        */}
        <section id="switching" className="scroll-mt-20 py-24 md:py-32">
          <div className="mx-auto grid max-w-container items-center gap-14 px-6 lg:grid-cols-[1fr_1.1fr]">
            <Reveal>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-brand-600">Switching</p>
              <h2 className="mt-4 font-display text-2xl leading-tight text-ink md:text-3xl">
                Bring your community with you
              </h2>
              <p className="mt-5 text-md text-ink-soft">
                You don’t start over. MaybeOS moves in the members, dues and records you already have, and nobody has to
                sign up again.
              </p>

              <div className="mt-10 space-y-7">
                {MIGRATION.map(({ Icon, title, body }) => (
                  <div key={title} className="flex gap-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border-[1.5px] border-ink bg-white shadow-hard-sm">
                      <Icon className="h-5 w-5 text-brand-600" />
                    </span>
                    <div>
                      <h3 className="font-display text-lg text-ink">{title}</h3>
                      <p className="mt-1 text-base text-ink-soft">{body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Reveal>

            <Reveal delay={150}>
              <div className="card p-0" aria-hidden="true">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b-[1.5px] border-ink px-5 py-4">
                  <p className="flex items-center gap-2 font-display text-lg text-ink">
                    <ScanSearch className="h-5 w-5 text-brand-600" /> Your Stripe subscriptions
                  </p>
                  <span className="rounded-full bg-moss-tint px-2.5 py-0.5 text-xs font-semibold text-moss">
                    Preview · nothing saved yet
                  </span>
                </div>
                <ul className="divide-y divide-ink/10">
                  {MATCHES.map((row, i) => (
                    <li
                      key={row.email}
                      className={`${styles.popIn} flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm`}
                      style={{ ['--delay' as string]: `${300 + i * 220}ms` }}
                    >
                      <span className="min-w-0">
                        <span className="block font-mono text-xs text-ink-soft">{row.email}</span>
                        <span className="text-ink">{row.tier}</span>
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          row.outcome === 'New member' ? 'bg-mustard-tint text-ink' : 'bg-moss-tint text-moss'
                        }`}
                      >
                        {row.outcome}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center gap-2 border-t-[1.5px] border-ink bg-paper px-5 py-4 text-sm text-ink">
                  <CreditCard className="h-4 w-4 text-ink-soft" />
                  Billing stays in Stripe. No card re-entered, no new billing date.
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── What we promise ────────────────────────────────── */}
        <section className="py-24 md:py-28">
          <div className="mx-auto grid max-w-container gap-10 px-6 md:grid-cols-3">
            {[
              {
                title: 'Flat fees. Never a percentage.',
                body: 'A flat fee is added on top of tickets and paid room hire, and of dues on the Free plan, shown to the person paying. It never comes out of the price you set.',
              },
              {
                title: 'Private by default.',
                body: 'Members never see each other’s contact details. Answers to your questions are only shown in groups: nobody sees one person’s answers, not even you.',
              },
              {
                title: 'Yours to leave.',
                body: 'MaybeOS is open source under Apache 2.0. Read every line, host it yourself for free, or let us run it for you.',
              },
            ].map((promise, i) => (
              <Reveal key={promise.title} delay={i * 120} className="border-t-[3px] border-ink pt-6">
                <h3 className="font-display text-xl leading-tight text-ink">{promise.title}</h3>
                <p className="mt-3 text-base text-ink-soft">{promise.body}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Pricing ────────────────────────────────────────── */}
        <section id="pricing" className="scroll-mt-20 border-t-[1.5px] border-ink bg-paper-dim py-24 md:py-32">
          <div className="mx-auto max-w-container px-6">
            <Reveal className="mx-auto max-w-2xl text-center">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-brand-600">Pricing</p>
              <h2 className="mt-4 font-display text-2xl leading-tight text-ink md:text-3xl">Priced so cost never blocks a community</h2>
              <p className="mt-5 text-md text-ink-soft">
                Pay nothing up front and a little more on each sale, or subscribe and pay less on each sale. Every plan
                has every feature, and fees are flat, never a percentage.
              </p>
            </Reveal>

            <PricingPlans />
          </div>
        </section>

        {/* ── Built inside a real community ──────────────────── */}
        <section className="bg-ink text-paper">
          <div className="mx-auto grid max-w-container items-center gap-12 px-6 py-24 md:grid-cols-[1.2fr_1fr] md:py-28">
            <Reveal>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-paper/60">Why it exists</p>
              <h2 className="mt-4 font-display text-2xl leading-tight md:text-3xl">
                Built inside a real community, by the people who run it.
              </h2>
              <p className="mt-6 max-w-xl text-md text-paper/75">
                Community software is built for companies with procurement departments. The pricing assumes headcount, the
                features assume a manager. MaybeOS is made by MaybeItsFate, and MaybeItsFate runs on it: its members, dues,
                events and conversations. When something is missing, we feel it first.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link href="/register" className="btn-primary px-6 py-3 text-base">
                  Start free
                </Link>
                <a
                  href={SOURCE_URL}
                  className="inline-flex items-center rounded-md border-[1.5px] border-paper px-6 py-3 text-base font-semibold text-paper transition-colors hover:bg-paper hover:text-ink"
                >
                  Read the source
                </a>
              </div>
            </Reveal>

            <Reveal delay={150}>
              <div className="rounded-lg border-[1.5px] border-paper/30 bg-paper/5 p-6 font-mono text-sm text-paper/80">
                <p className="text-paper/50">$ git clone {SOURCE_URL.replace('https://', '')}</p>
                <p className="mt-3">
                  <span className="text-moss-tint">✓</span> Apache 2.0
                </p>
                <p>
                  <span className="text-moss-tint">✓</span> Host it yourself, free
                </p>
                <p>
                  <span className="text-moss-tint">✓</span> Or let us run it for you
                </p>
                <p>
                  <span className="text-moss-tint">✓</span> Leave any time
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── Last word ──────────────────────────────────────── */}
        <section className="py-24 md:py-32">
          <Reveal className="mx-auto max-w-3xl px-6 text-center">
            <h2 className="font-display text-2xl leading-tight text-ink md:text-4xl">
              Your community already does the hard part. Let the software keep up.
            </h2>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <Link href="/register" className="btn-primary group px-7 py-3.5 text-base">
                Start free
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link href="/login" className="btn-secondary px-7 py-3.5 text-base">
                Sign in
              </Link>
            </div>
          </Reveal>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t-[1.5px] border-ink">
        <div className="mx-auto flex max-w-container flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-ink-soft">
          <div className="flex items-center gap-4">
            <Wordmark height={20} />
            <span>Made by MaybeItsFate LCA</span>
          </div>
          <nav className="flex flex-wrap gap-5" aria-label="Footer">
            <a href={SOURCE_URL} className="hover:text-ink">Source</a>
            <a href={supportMailto()} className="hover:text-ink">{SUPPORT_EMAIL}</a>
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
            <Link href="/terms" className="hover:text-ink">Terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
