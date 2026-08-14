import type { Metadata } from 'next';
import { LegalPage, Section } from '@/components/legal/legal-page';

export const metadata: Metadata = {
  title: 'Privacy — MaybeOS',
  description:
    'What MaybeOS collects, what it never collects, and who else can see it. No advertising, no analytics, no data sales.',
};

/**
 * The privacy statement.
 *
 * Every claim here was checked against the code before it was written, because
 * this is the one document where a sentence that is *nearly* true is a lie
 * somebody may rely on. Where the product does something less absolute than
 * "we track nothing" — Sentry receiving an IP address, Stripe seeing a buyer's
 * email — it says so plainly rather than rounding in MaybeOS's favour.
 *
 * The claims and where they come from:
 *   no analytics / ad tech  — nothing in apps/web; verified by search
 *   Sentry gets id only     — auth-store.ts, `Sentry.setUser({ id })`
 *   URLs scrubbed           — sentry.shared.ts, `scrubEvent` (OPS-07)
 *   members can't see each  — contact-visibility.ts (SEC-06)
 *   demographics optional   — IMP-17, member-owned, deletable
 *   n < 5 suppression       — impact aggregation, not a display toggle
 *   orgs firewalled         — CMN-07, SEC-04, D-009
 *   self-hosting            — Apache 2.0 (D-013)
 */
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      updated="14 August 2026"
      summary="MaybeOS does not advertise, does not sell or share your data, and runs no analytics or tracking of any kind. What follows is the specific version of that — including the handful of companies that necessarily see something, and exactly what."
    >
      <Section heading="What we do not do">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>No advertising.</strong> MaybeOS carries no ads and never will.
            Nothing here is funded by attention.
          </li>
          <li>
            <strong>No analytics or tracking.</strong> There is no Google Analytics,
            no tag manager, no Meta pixel, no session recorder, no heatmap tool, no
            product-analytics SDK. Not configured off — not present.
          </li>
          <li>
            <strong>No selling or sharing.</strong> We do not sell, rent, licence or
            trade member data, and we do not share it with anyone for their own
            purposes.
          </li>
          <li>
            <strong>No tracking cookies.</strong> MaybeOS sets no advertising or
            analytics cookies. Signing in stores a session token in your browser so
            you stay signed in; that is all it is for.
          </li>
          <li>
            <strong>No cross-co-op profiles.</strong> Co-ops are walled off from one
            another in the database itself. Belonging to two co-ops does not merge
            you into one profile, and what you tell one is not visible to the other.
          </li>
        </ul>
      </Section>

      <Section heading="What your co-op can see">
        <p>
          MaybeOS is software your co-op runs. Its organisers can see what they need
          to run it: who is a member, what people have booked and signed up for,
          what is owed. That is the ordinary business of a membership organisation.
        </p>
        <p>
          <strong>Other members see far less.</strong> A member cannot see another
          member&apos;s email address, phone number, billing details or subscription
          status. Being in the same co-op does not hand you the membership list.
          Only admins and staff see contact details, because contacting members is
          their job.
        </p>
        <p>
          Search works the same way: you cannot search by email address, because
          that would answer &ldquo;is this person a member here?&rdquo; for anyone
          holding a list of addresses to try.
        </p>
      </Section>

      <Section heading="Impact questions and demographics">
        <p>
          Some co-ops measure whether their work is doing what they hoped. If yours
          does, two rules hold:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Answering is optional, always.</strong> Every demographic field
            can be skipped individually, and &ldquo;prefer not to say&rdquo; is a
            real answer that is counted separately from silence. You can delete your
            profile at any time and the figures recompute without it.
          </li>
          <li>
            <strong>Organisers never see individual answers.</strong> They see
            aggregates only — and any group smaller than five people is suppressed
            automatically, so a small category cannot be narrowed down to a person.
            That suppression is not a setting anyone can switch off.
          </li>
        </ul>
        <p>
          Demographics are attached to your membership of one co-op, not to you as a
          person. Telling one co-op something is not telling another.
        </p>
      </Section>

      <Section heading="Who else sees anything">
        <p>
          MaybeOS cannot run without a few specialist companies, and pretending
          otherwise would be the dishonest part of a privacy policy. Each one sees
          only what its job requires:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Supabase</strong> — hosts the database. Everything stored lives
            there.
          </li>
          <li>
            <strong>Netlify</strong> — hosts and serves the application.
          </li>
          <li>
            <strong>Stripe</strong> — processes payments. Sees what it needs to take
            a payment: name, email, payment details. MaybeOS never sees or stores
            your card number.
          </li>
          <li>
            <strong>Postmark</strong> — delivers email. Sees the address and the
            message, because that is what sending email is.
          </li>
          <li>
            <strong>Sentry</strong> — receives error reports when something breaks.
            This is the one worth being precise about: a report identifies you by an
            internal account ID, <em>never</em> your name or email address, and is
            cleared when you sign out. Reports do include the IP address the request
            came from, which Sentry may resolve to a city. Web addresses and the
            trail of actions leading to an error are stripped of sign-in links and
            tokens before they are sent.
          </li>
          <li>
            <strong>Google Calendar</strong> — only if your co-op connects a room
            calendar, and only for that room&apos;s bookings.
          </li>
        </ul>
      </Section>

      <Section heading="If you would rather not take our word for it">
        <p>
          MaybeOS is open source under the Apache 2.0 licence. You can read exactly
          what it does with your data, and a co-op that wants to can host it itself,
          on its own infrastructure, with no involvement from us at all. A privacy
          promise you can verify is worth more than one you cannot.
        </p>
      </Section>

      <Section heading="Your data is yours">
        <p>
          Ask and we will tell you what is held about you, correct it, or delete it.
          Deleting a demographic profile takes effect immediately and removes it from
          every figure it fed. If your co-op leaves MaybeOS, its data goes with it.
        </p>
        <p>
          Questions, or anything here that does not match what you have seen:{' '}
          <a href="mailto:c@maybeitsfate.com" className="underline">
            c@maybeitsfate.com
          </a>
          .
        </p>
      </Section>

      <Section heading="Changes">
        <p>
          If this statement changes in a way that affects what is collected or who
          sees it, we will say so rather than quietly reissuing the page with a new
          date.
        </p>
      </Section>
    </LegalPage>
  );
}
