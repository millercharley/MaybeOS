'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Check, HeartHandshake, Loader2 } from 'lucide-react';

type Result =
  | { status: 'accepted' | 'declined'; communityName: string }
  | { status: 'already-covered' }
  | { status: 'unknown' };

/**
 * Answering a buddy invitation, from a link in an email (PRD §5.1).
 *
 * **No login, on purpose.** Somebody being asked to welcome a new member
 * should be able to say yes from their phone without first remembering a
 * password — a login wall between the ask and the answer is a login wall
 * between a new member and their first friend here.
 *
 * There is no confirm step. The email had two buttons and pressing one *was*
 * the decision; making somebody confirm it on arrival would be asking the
 * same question twice and would lose the people who assume it worked.
 */
function BuddyAnswer() {
  const token = useParams<{ token: string }>().token;
  const answer = useSearchParams().get('answer') === 'decline' ? 'decline' : 'accept';
  const [result, setResult] = useState<Result | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_URL ?? '';
    fetch(`${base}/api/buddy/${token}?answer=${answer}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then(setResult)
      .catch(() => setFailed(true));
  }, [token, answer]);

  if (failed) {
    return (
      <Panel title="Something went wrong at our end">
        Nothing has been recorded. Try the link in your email again in a minute — and if it still
        doesn&rsquo;t work, replying to whoever asked you is just as good.
      </Panel>
    );
  }

  if (!result) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }

  if (result.status === 'accepted') {
    return (
      <Panel icon={<Check className="h-6 w-6 text-green-600" />} title="Thank you">
        We&rsquo;ve introduced you both by email. The only thing that matters now is the first
        message, and it doesn&rsquo;t have to be good.
      </Panel>
    );
  }

  if (result.status === 'declined') {
    return (
      <Panel title="No problem at all">
        We&rsquo;ll ask somebody else. Saying no this time doesn&rsquo;t take you out of the
        rotation — we&rsquo;ll come back to you another time, unless you&rsquo;d rather we
        didn&rsquo;t.
      </Panel>
    );
  }

  if (result.status === 'already-covered') {
    // A late click on a superseded or expired invitation. They did nothing
    // wrong and should not be made to feel they missed something.
    return (
      <Panel title="This one is already covered">
        Somebody else got there first, so there&rsquo;s nothing for you to do. Thank you for
        opening it.
      </Panel>
    );
  }

  return (
    <Panel title="We don’t recognize this link">
      It may have been used already, or copied incompletely from the email. Nothing has been
      recorded either way.
    </Panel>
  );
}

function Panel({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md px-6 py-20 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50">
        {icon ?? <HeartHandshake className="h-6 w-6 text-brand-600" />}
      </div>
      <h1 className="mt-5 text-2xl font-bold text-gray-900">{title}</h1>
      <p className="mt-3 text-gray-600">{children}</p>
    </div>
  );
}

export default function BuddyAnswerPage() {
  // `useSearchParams` needs a boundary or the whole route opts out of static
  // rendering with a build-time error.
  return (
    <Suspense fallback={null}>
      <BuddyAnswer />
    </Suspense>
  );
}
