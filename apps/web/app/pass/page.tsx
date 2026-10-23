'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, CalendarDays, MapPin, Ticket } from 'lucide-react';
import {
  initialPassState,
  loadPass,
  passNotice,
  PassState,
  seatLine,
} from '@/lib/ticket-pass';

/**
 * The page a ticket buyer shows at the door (EVT-46).
 *
 * **No sign-in.** The people this serves bought a ticket to a public show and
 * have no account. Annette Neblett bought two seats to *Dog Sees God*, was
 * sent nothing at all, and wrote in to ask what to do — and there was nothing
 * to send her, because the only record of her purchase lived behind a session
 * she had no reason to have. The signed token in the address is the
 * authorisation, exactly as it is for an unsubscribe link.
 *
 * **Read on arrival, unlike the unsubscribe page.** That one waits for a
 * press because a link scanner must not be able to switch somebody's email
 * off. This only reads, so there is nothing a scanner can do by following it,
 * and a page that made somebody tap twice while a queue waits behind them is
 * worse than useless.
 *
 * **The seat count is the page.** Everything else — the show, the night, the
 * room — is confirmation that this is the right pass. The number is the thing
 * being proved, so it is set large enough to be read at arm's length over a
 * doorman's shoulder in a dark lobby.
 */
function Pass() {
  // Straight off the address and held in a local. Never stored: a credential
  // in localStorage outlives the evening it was for.
  const token = useSearchParams().get('token');
  const [state, setState] = useState<PassState>(() => initialPassState(token));

  useEffect(() => {
    let live = true;
    if (!token) return;

    loadPass(token).then((next) => {
      // A door pass is opened once and left open. If the component has gone,
      // the person has navigated away and the answer is no longer wanted.
      if (live) setState(next);
    });

    return () => {
      live = false;
    };
  }, [token]);

  if (state.kind === 'loading') {
    return (
      <Shell>
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </Shell>
    );
  }

  if (state.kind === 'failed') {
    return (
      <Shell>
        <AlertCircle className="mx-auto h-8 w-8 text-brand-600" />
        <h1 className="mt-5 font-display text-2xl leading-tight text-ink">
          Couldn&apos;t load your pass
        </h1>
        <p className="mt-3 text-sm text-ink-soft">
          The connection didn&apos;t go through. Your tickets are safe — try again, and if
          it still won&apos;t load, show this email to whoever is on the door.
        </p>
        <button
          type="button"
          onClick={() => {
            setState({ kind: 'loading' });
            loadPass(token).then(setState);
          }}
          className="btn-primary mt-6 text-sm"
        >
          Try again
        </button>
      </Shell>
    );
  }

  if (state.kind === 'badLink') {
    return (
      <Shell>
        <AlertCircle className="mx-auto h-8 w-8 text-brand-600" />
        <h1 className="mt-5 font-display text-2xl leading-tight text-ink">
          This pass link didn&apos;t work
        </h1>
        {/*
          One message for every reason it failed — a mistyped link, a cancelled
          show, a refunded ticket. The API answers the same way for all of
          them so that a guessed token cannot be used to find out whether it
          named a real sale, and saying more here would undo that.
        */}
        <p className="mt-3 text-sm text-ink-soft">
          Links get cut in half when they&apos;re copied by hand, so check you have the
          whole one from your confirmation email. If it still won&apos;t open, reply to
          that email — whoever runs the event can look you up by name.
        </p>
      </Shell>
    );
  }

  const { pass } = state;
  const notice = passNotice(pass.event);

  return (
    <Shell>
      <p className="font-display text-sm uppercase tracking-wide text-ink-soft">
        {pass.event.orgName}
      </p>
      <h1 className="mt-1 font-display text-2xl leading-tight text-ink">
        {pass.event.title}
      </h1>

      <div className="mt-5 space-y-2 text-sm text-ink-soft">
        <p className="flex items-start justify-center gap-2">
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{pass.event.when}</span>
        </p>
        {pass.event.where && (
          <p className="flex items-start justify-center gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{pass.event.where}</span>
          </p>
        )}
      </div>

      {/*
        The proof. Bordered and oversized because of where it gets read: at
        arm's length, in a lobby, by somebody who is also counting a queue.
      */}
      <div className="mt-6 rounded-xl border-2 border-ink bg-paper-dim px-6 py-5">
        <Ticket className="mx-auto h-5 w-5 text-ink-soft" />
        <p className="mt-2 font-display text-5xl font-bold leading-none text-ink">
          {seatLine(pass.seats)}
        </p>
        {pass.holder.name && (
          <p className="mt-3 font-display text-lg text-ink">{pass.holder.name}</p>
        )}
        <p className="mt-1 break-all text-xs text-ink-soft">{pass.holder.email}</p>
      </div>

      {notice && (
        <p className="mt-5 rounded-lg bg-paper-dim px-4 py-3 text-sm text-ink">{notice}</p>
      )}

      <p className="mt-5 text-xs text-ink-soft">
        {/*
          Said out loud because it is the question somebody asks before they
          leave the house: a buyer who checks out twice has two emails and one
          link, and needs to know the link is the one that is right.
        */}
        This page is always current. If you buy more seats, open this same link again
        and the number will have gone up.
      </p>
    </Shell>
  );
}

/**
 * One card in an empty viewport — the shape every page reached from an email
 * already uses (the unsubscribe, the buddy answer, the invitation). Outside
 * the app shell on purpose: there is no session here, so there is no sidebar
 * to draw.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-12">
      <div className="card w-full max-w-md text-center">{children}</div>
    </div>
  );
}

export default function TicketPassPage() {
  // `useSearchParams` opts the route out of static rendering, and Next fails
  // the build rather than doing it quietly.
  return (
    <Suspense fallback={null}>
      <Pass />
    </Suspense>
  );
}
