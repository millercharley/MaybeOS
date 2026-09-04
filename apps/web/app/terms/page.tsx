import type { Metadata } from 'next';
import { LegalPage, Section } from '@/components/legal/legal-page';

export const metadata: Metadata = {
  title: 'Terms of Service — MaybeOS',
  description:
    'Terms for the co-ops that run MaybeOS and the members who use it. Who is responsible for what, how money works, and what happens if you leave.',
};

/**
 * Terms of service, written for two audiences at once (Charley, 2026-08-13):
 * the operators of a community and its members. Those are different
 * relationships — an operator agrees to MaybeOS's terms, while a member's
 * relationship is mostly with their own co-op — and a document that blurs them
 * leaves both unsure which sentences apply.
 *
 * Written to match what the product actually does. The fee figures come from
 * D-013; the refund and cancellation behaviour from EVT-06 and SPC-06; the
 * self-hosting right from the Apache 2.0 licence.
 */
export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="14 August 2026"
      summary="MaybeOS is software a co-op runs to manage itself. These terms cover two different relationships: the co-op that operates a community here, and the members who use it. Where a rule applies to only one of them, it says so."
    >
      <Section heading="Who these terms are between">
        <p>
          MaybeOS is operated by <strong>MaybeItsFate LCA</strong>, a for-profit
          company. &ldquo;We&rdquo; means MaybeItsFate; &ldquo;MaybeOS&rdquo; means
          the software and the service at maybeos.org.
        </p>
        <p>
          A <strong>co-op</strong> — any community, club, collective or organization
          that creates a space here — agrees to these terms when it does so. Its
          <strong> members</strong> agree to them when they join or use that space.
          Members also have a relationship with their own co-op, governed by that
          co-op&apos;s own rules, which we are not party to.
        </p>
      </Section>

      <Section heading="For co-ops running a community">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>You own your data and your relationships.</strong> Your members
            are yours, not ours. We will not market to them, and we will not contact
            them except to deliver something MaybeOS is doing on your behalf.
          </li>
          <li>
            <strong>You are responsible for what your community does here</strong> —
            what is posted, what is charged, and how you treat your members. You
            decide who may join and who may stay.
          </li>
          <li>
            <strong>You are the merchant.</strong> When you sell tickets or charge
            for a room, the money goes to your own Stripe account. MaybeOS never
            holds it. That also makes you responsible for refunds, chargebacks, and
            any tax on what you collect.
          </li>
          <li>
            <strong>You must have the right to charge what you charge</strong> and to
            run what you run, including any licenses or permissions your activities
            need. We do not check this, and cannot.
          </li>
          <li>
            <strong>You may leave and take everything.</strong> Export your data or
            move to a self-hosted copy at any time. We will not hold your community
            hostage to keep your subscription.
          </li>
        </ul>
      </Section>

      <Section heading="For members of a community">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Your co-op sets its own rules</strong> — dues, conduct, who may
            join, what happens at events. Disputes about those are between you and
            your co-op. We do not adjudicate them.
          </li>
          <li>
            <strong>Your account is yours.</strong> Keep your sign-in details to
            yourself. Tell us or your organizers if you think someone else has them.
          </li>
          <li>
            <strong>What you post is yours</strong>, and you are responsible for it.
            Do not post things you have no right to post.
          </li>
          <li>
            <strong>Money you pay goes to your co-op</strong>, not to MaybeOS, apart
            from a small fixed fee described below. Refunds are your co-op&apos;s to
            give.
          </li>
          <li>
            <strong>You can leave.</strong> Ask your co-op to remove you, or ask us.
          </li>
        </ul>
      </Section>

      <Section heading="What MaybeOS costs">
        <p>
          A co-op can run MaybeOS free. When money moves through it, we take a{' '}
          <strong>flat fee per transaction</strong> — never a percentage of your door:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>Free</strong> — $0/month, 55¢ per transaction</li>
          <li><strong>Plus</strong> — $100 to set up, $3.65 per user per year, 30¢ per transaction</li>
          <li><strong>Unlimited</strong> — $299–349/month, 10¢ per transaction</li>
        </ul>
        <p>
          Fees are <strong>added to</strong> the price a co-op sets, not taken out of
          it. A co-op charging $10 for a ticket receives $10. The buyer sees the fee
          as a fee. Stripe charges its own processing fees separately, to the co-op.
        </p>
        <p>
          When a booking or ticket is refunded, our fee is refunded too. We do not
          keep a cut of something that did not happen.
        </p>
        <p>
          You can also run MaybeOS yourself, on your own servers, for nothing —
          it is open source under the Apache 2.0 license.
        </p>
      </Section>

      <Section heading="Gifts">
        <p>
          If you choose to support MaybeOS with a gift, thank you — and please note
          that <strong>MaybeItsFate LCA is a for-profit company, so gifts are not
          tax deductible</strong>. We would rather say that plainly than let anyone
          assume otherwise.
        </p>
      </Section>

      <Section heading="What we will and will not do">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            We will keep the service running as well as we reasonably can, tell you
            when something breaks, and not pretend an outage did not happen.
          </li>
          <li>
            We do not guarantee uninterrupted service. MaybeOS is provided as is,
            without warranties. Where the law allows, our liability is limited to
            what you paid us in the previous twelve months.
          </li>
          <li>
            We may suspend an account for non-payment, or for activity that is
            illegal or that endangers other people or the service. We will tell you
            why.
          </li>
          <li>
            If we make a material change to these terms, we will give notice before
            it takes effect rather than reissuing the page quietly.
          </li>
        </ul>
      </Section>

      <Section heading="Ending it">
        <p>
          A co-op may stop using MaybeOS at any time and take its data. A member may
          leave at any time. If we ever discontinue the service, we will give
          reasonable notice and time to export — and because the software is open
          source, a co-op can keep running it regardless.
        </p>
      </Section>

      <Section heading="Contact">
        <p>
          MaybeItsFate LCA, Louisville, Kentucky.{' '}
          <a href="mailto:c@maybeitsfate.com" className="underline">
            c@maybeitsfate.com
          </a>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
