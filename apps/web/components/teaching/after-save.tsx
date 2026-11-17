'use client';

import Link from 'next/link';
import { CalendarCheck, DoorOpen, EyeOff, Send, X } from 'lucide-react';
import { Panel } from '@/components/layout/panel';
import { datesWaiting, stepsAfterPublish } from '@/lib/teaching';
import type { Offering } from '@/lib/api';

/**
 * What happens next, said at the two moments a teacher is wondering
 * (TCH-02).
 *
 * Charley asked for both: prompt them to publish once the draft is saved,
 * and once it is published, prompt them about rooms and the events calendar.
 *
 * **Not a modal, and not a wizard.** A panel on the page they are already
 * looking at, above the list, which they can dismiss. A teacher who knows
 * what they are doing presses Publish and never reads it; a modal would make
 * that person click twice.
 *
 * The calendar half needed correcting rather than building. A workshop's
 * dates *are* events, so publishing puts them on the calendar — there is
 * nothing left to offer. Saying "it's on the calendar, here it is" is the
 * true version of the same reassurance, and `stepsAfterPublish` decides when
 * it can honestly be said.
 */
export function AfterSave({
  offering,
  stage,
  orgSlug,
  onPublish,
  onDismiss,
  busy,
}: {
  offering: Offering;
  stage: 'draft' | 'published';
  orgSlug: string;
  onPublish: () => void;
  onDismiss: () => void;
  busy?: boolean;
}) {
  const dates = offering.sessions?.length ?? 0;

  if (stage === 'draft') return <DraftSaved {...{ offering, dates, onPublish, onDismiss, busy }} />;

  return <Published offering={offering} orgSlug={orgSlug} dates={dates} onDismiss={onDismiss} />;
}

/**
 * The draft is saved and nobody can see it. That is the whole message.
 *
 * It names what is hidden rather than saying "draft", because the word means
 * nothing until somebody tells you what it costs you. Where dates were added
 * in the form, it says they are off the calendar too — that is the part a
 * teacher would otherwise assume had happened.
 */
function DraftSaved({
  offering,
  dates,
  onPublish,
  onDismiss,
  busy,
}: {
  offering: Offering;
  dates: number;
  onPublish: () => void;
  onDismiss: () => void;
  busy?: boolean;
}) {
  return (
    <Panel
      title={`“${offering.title}” is saved as a draft`}
      actions={<DismissButton onDismiss={onDismiss} />}
    >
      <p className="text-sm text-[var(--text-secondary)]">
        {dates > 0 ? (
          <>
            Nobody can see it yet, and {dates === 1 ? 'the date you added is' : `the ${dates} dates you added are`}{' '}
            not on the co&#8209;op calendar. Publishing puts{' '}
            {dates === 1 ? 'it' : 'them'} up.
          </>
        ) : (
          <>
            Nobody can see it yet. Publish it when you are ready — you can add dates before or
            after, and a workshop can go up with none while you gather interest.
          </>
        )}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={onPublish} disabled={busy}>
          <Send className="mr-1.5 inline h-4 w-4" aria-hidden />
          {busy ? 'Publishing…' : 'Publish it'}
        </button>
        <button type="button" className="btn-ghost" onClick={onDismiss} disabled={busy}>
          Leave it as a draft
        </button>
      </div>
    </Panel>
  );
}

/**
 * It is live. What is still worth doing, and nothing that is not.
 *
 * Every line here is conditional, because an unconditional list of next steps
 * is one people stop reading. `stepsAfterPublish` holds the conditions and
 * has its own spec.
 */
function Published({
  offering,
  orgSlug,
  dates,
  onDismiss,
}: {
  offering: Offering;
  orgSlug: string;
  dates: number;
  onDismiss: () => void;
}) {
  const steps = stepsAfterPublish(offering);
  const waiting = datesWaiting(offering);

  return (
    <Panel
      title={`“${offering.title}” is live`}
      actions={<DismissButton onDismiss={onDismiss} />}
    >
      <ul className="space-y-3 text-sm">
        {steps.includes('calendar') && (
          <Step icon={CalendarCheck}>
            <>
              {dates === 1 ? 'Its date is' : `All ${dates} dates are`} on the co&#8209;op
              events calendar, open to{' '}
              {offering.visibility === 'PUBLIC' ? 'anyone' : 'members'}.{' '}
              <Link
                href={`/portal/${orgSlug}/events`}
                className="font-medium text-brand-600 hover:text-brand-700"
              >
                See the calendar
              </Link>
              .
            </>
          </Step>
        )}

        {steps.includes('private') && (
          <Step icon={EyeOff}>
            <>
              {dates === 1 ? 'Its date is' : 'Its dates are'} not on the events calendar,
              because this workshop is kept off the lists. Change who can see it and{' '}
              {dates === 1 ? 'it' : 'they'} will appear.
            </>
          </Step>
        )}

        {steps.includes('needs-room') && (
          <Step icon={DoorOpen}>
            <>
              {waiting === 1 ? 'One date is' : `${waiting} dates are`} still waiting, because
              this co&#8209;op asks every event to say which room it is in.{' '}
              <Link
                href={`/member/${orgSlug}/events`}
                className="font-medium text-brand-600 hover:text-brand-700"
              >
                Add a room
              </Link>{' '}
              and {waiting === 1 ? 'it goes' : 'they go'} up.
            </>
          </Step>
        )}

        {steps.includes('room') && (
          <Step icon={DoorOpen}>
            <>
              Does it need a space? Book a room against{' '}
              {dates === 1 ? 'the date' : 'the dates'} so nobody else takes it.{' '}
              <Link
                href={`/portal/${orgSlug}/rooms`}
                className="font-medium text-brand-600 hover:text-brand-700"
              >
                Find a room
              </Link>
              .
            </>
          </Step>
        )}

        {/*
          Nothing with a date to talk about. The two cases read differently and
          must: a private lesson *cannot* have dates — the API refuses them —
          so telling a piano teacher to add some sends them looking for a
          button that is not there, and should not be.
        */}
        {steps.length === 0 && (
          <Step icon={CalendarCheck}>
            {offering.kind === 'PRIVATE_LESSON' ? (
              <>
                People can find it now, and whoever wants a lesson will get in touch to arrange
                a time with you.
              </>
            ) : (
              <>
                People can find it now. Add dates whenever you know them, and they go on the
                events calendar as you add them.
              </>
            )}
          </Step>
        )}
      </ul>
    </Panel>
  );
}

function Step({
  icon: Icon,
  children,
}: {
  icon: typeof CalendarCheck;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-tertiary)]" aria-hidden />
      <span className="text-[var(--text-secondary)]">{children}</span>
    </li>
  );
}

function DismissButton({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button type="button" className="btn-ghost px-2 py-1 text-sm" onClick={onDismiss}>
      <X className="h-4 w-4" aria-hidden />
      <span className="sr-only">Dismiss</span>
    </button>
  );
}
