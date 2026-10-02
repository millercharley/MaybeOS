'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, Check, MailX } from 'lucide-react';
import {
  initialUnsubscribeState,
  stopRadarEmails,
  UnsubscribeState,
} from '@/lib/radar-unsubscribe';

/**
 * Turning off the weekly Radar digest, from the link at the foot of one
 * (RDR-01).
 *
 * **No sign-in.** The signed token in the address is the authorization, and
 * it authorizes one thing: this membership's digest. A login wall in front of
 * an unsubscribe is how an unsubscribe becomes a spam complaint — somebody
 * who cannot remember their password presses the junk button instead, and
 * that lands on the co-op's sending reputation rather than on ours.
 *
 * **Nothing happens on load.** The member has to press the button, and the
 * API exposes this as a POST so that it cannot happen any other way. Mail
 * clients, link previewers and corporate security products fetch every URL
 * in a message before a human sees it; a page that unsubscribed on arrival
 * would switch off members who never opened the email, and the co-op would
 * only ever find out from the silence.
 */
function RadarUnsubscribe() {
  // The whole credential, straight off the address. Held in a local and
  // never stored — a token in localStorage outlives the one click it is for.
  const token = useSearchParams().get('token');
  const [state, setState] = useState<UnsubscribeState>(() =>
    initialUnsubscribeState(token),
  );

  async function stop() {
    setState({ kind: 'stopping' });
    setState(await stopRadarEmails(token));
  }

  if (state.kind === 'stopped') {
    return (
      <Panel
        icon={<Check className="h-6 w-6 text-green-600" />}
        title="Those emails have stopped"
        body={
          `${state.orgName ?? 'Your co-op'} won’t send you the weekly Radar digest again. ` +
          'Everything else they send — event announcements, messages, anything from an ' +
          'organizer — is unchanged. This only turned off the digest.'
        }
      />
    );
  }

  if (state.kind === 'badLink') {
    return (
      <Panel
        icon={<AlertCircle className="h-6 w-6 text-brand-600" />}
        title="That link didn’t work"
        body="It may have been cut short by your mail app, or it may have been used already.
          Nothing has changed either way, so the digest is still coming. You can switch it
          off yourself — and change what it covers — from your profile."
      >
        <Link href="/login" className="btn-secondary text-sm">
          Sign in to change this
        </Link>
      </Panel>
    );
  }

  if (state.kind === 'failed') {
    return (
      <Panel
        icon={<AlertCircle className="h-6 w-6 text-brand-600" />}
        title="That didn’t go through"
        body="We couldn’t reach MaybeOS, so nothing has changed and the emails haven’t
          stopped yet. Try again in a moment."
      >
        <button type="button" onClick={stop} className="btn-primary text-sm">
          Try again
        </button>
      </Panel>
    );
  }

  return (
    <Panel
      icon={<MailX className="h-6 w-6 text-brand-600" />}
      title="Stop the Radar digest?"
      body="Radar is the weekly email matching what you’ve said you’re interested in to what
        your co-op has coming up. Stopping it leaves everything else your co-op sends you
        exactly as it is."
    >
      <button
        type="button"
        onClick={stop}
        disabled={state.kind === 'stopping'}
        className="btn-primary text-sm"
      >
        {state.kind === 'stopping' ? 'Stopping…' : 'Stop these emails'}
      </button>
    </Panel>
  );
}

/**
 * One card in an empty viewport — the shape every page reached from an email
 * already uses (the buddy answer, the invitation). Outside the app shell on
 * purpose: there is no session here, so there is no sidebar to draw and no
 * co-op to brand it with.
 */
function Panel({
  title,
  body,
  icon,
  children,
}: {
  title: string;
  body: string;
  icon: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-12">
      <div className="card w-full max-w-md text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-paper-dim">
          {icon}
        </div>
        <h1 className="mt-5 font-display text-2xl leading-tight text-ink">{title}</h1>
        <p className="mt-3 text-sm text-ink-soft">{body}</p>
        {children && <div className="mt-6">{children}</div>}
      </div>
    </div>
  );
}

export default function RadarUnsubscribePage() {
  // `useSearchParams` opts the route out of static rendering, and Next fails
  // the build rather than doing it quietly — so the boundary is required even
  // though there is nothing worth showing inside it.
  return (
    <Suspense fallback={null}>
      <RadarUnsubscribe />
    </Suspense>
  );
}
