'use client';

import { FormEvent, useState } from 'react';
import { Globe, Lock, Users } from 'lucide-react';
import { CreateEventData } from '@/lib/api';

/**
 * The event form (EVT-05).
 *
 * There has never been one. "Create Event" on the admin events page has been a
 * button with no handler since it was built, so every event in MaybeOS was
 * seeded or written straight to the database.
 *
 * Two things it is careful about, because they are the ones a member cannot
 * take back once other people have seen the result:
 *
 *   - **Visibility is an explicit choice, described in plain terms.** "Anyone
 *     on the web" is the honest description of PUBLIC, not "public", and it is
 *     not the default.
 *   - **Publish is separate from save.** Somebody writing a description over
 *     two sittings should not be broadcasting a half-finished event in the
 *     meantime.
 */

export interface EventFormValues extends CreateEventData {
  publish?: boolean;
}

/** MaybeOS's per-transaction fee by plan, in cents (D-013). */
const PLATFORM_FEE_CENTS: Record<string, number> = { FREE: 55, PLUS: 30, UNLIMITED: 10 };

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const VISIBILITIES = [
  {
    value: 'MEMBERS_ONLY',
    label: 'Members only',
    hint: 'Everyone in your co-op can see it.',
    icon: Users,
  },
  {
    value: 'PUBLIC',
    label: 'Anyone on the web',
    hint: "It appears on your co-op's public events page.",
    icon: Globe,
  },
  {
    value: 'PRIVATE',
    label: 'Just me for now',
    hint: 'Nobody else sees it until you change this.',
    icon: Lock,
  },
];

/** `2027-04-05T14:00:00.000Z` → the `datetime-local` value for that instant. */
function toLocalInput(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function EventForm({
  initial,
  alreadyPublished = false,
  submitLabel = 'Create event',
  busy = false,
  error = '',
  onSubmit,
  onCancel,
  plan = 'FREE',
  orgFeeCents = 0,
  canSellTickets = false,
  hosts,
}: {
  initial?: Partial<EventFormValues>;
  /** Editing something already live: there is no unpublish, so no draft button. */
  alreadyPublished?: boolean;
  submitLabel?: string;
  busy?: boolean;
  error?: string;
  onSubmit: (values: EventFormValues) => void;
  onCancel?: () => void;
  /** The co-op's MaybeOS plan, which sets the per-transaction fee (D-013). */
  plan?: string;
  /** A fee the co-op adds on top of MaybeOS's, in cents. */
  orgFeeCents?: number;
  /** Whether Stripe onboarding is finished. Without it, tickets cannot sell. */
  canSellTickets?: boolean;
  /**
   * Members an organiser may hand the event to (EVT-04). Omitted on the member
   * form, where you always host what you make — so the field simply does not
   * appear rather than appearing and being refused.
   */
  hosts?: { id: string; name: string }[];
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [startTime, setStartTime] = useState(toLocalInput(initial?.startTime));
  const [endTime, setEndTime] = useState(toLocalInput(initial?.endTime));
  const [visibility, setVisibility] = useState(initial?.visibility ?? 'MEMBERS_ONLY');
  const [capacity, setCapacity] = useState(initial?.capacity?.toString() ?? '');
  const [waitlist, setWaitlist] = useState(initial?.waitlistEnabled ?? false);
  // Free is the default and the common case for a co-op. Ticketed is a
  // deliberate step, not a price box sitting there inviting a number.
  const [ticketed, setTicketed] = useState(Boolean(initial?.priceCents));
  const [price, setPrice] = useState(
    initial?.priceCents ? (initial.priceCents / 100).toFixed(2) : '',
  );
  const [category, setCategory] = useState(initial?.category ?? '');
  const [hostId, setHostId] = useState(initial?.hostId ?? '');
  const [localError, setLocalError] = useState('');

  function submit(e: FormEvent, publish: boolean) {
    e.preventDefault();
    setLocalError('');

    if (!title.trim()) return setLocalError('Give it a name.');
    if (!startTime || !endTime) return setLocalError('Say when it starts and ends.');
    if (new Date(endTime) <= new Date(startTime)) {
      return setLocalError('It has to end after it starts.');
    }

    let priceCents: number | null = null;
    if (ticketed) {
      const parsed = Math.round(Number(price) * 100);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return setLocalError('Give the ticket a price, or make the event free.');
      }
      // Stripe refuses anything under 50c, and finding that out at checkout —
      // after somebody has published and shared the event — is far worse than
      // finding out here.
      if (parsed < 50) {
        return setLocalError('Stripe will not take payments under $0.50.');
      }
      priceCents = parsed;
    }

    onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      // The inputs are local time; the API stores instants.
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      visibility,
      capacity: capacity ? Number(capacity) : undefined,
      // Only meaningful alongside a limit — an event that cannot fill cannot
      // overflow — so it is never sent as true without one.
      waitlistEnabled: capacity ? waitlist : false,
      category: category.trim() || undefined,
      priceCents,
      ...(hosts && hostId ? { hostId } : {}),
      publish,
    });
  }

  const shown = error || localError;

  return (
    <form onSubmit={(e) => submit(e, true)} className="space-y-5">
      {shown && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {shown}
        </p>
      )}

      <div>
        <label htmlFor="event-title" className="mb-1 block text-sm font-medium text-gray-900">
          What is it?
        </label>
        <input
          id="event-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="Repair Café"
          className="input w-full"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="event-start" className="mb-1 block text-sm font-medium text-gray-900">
            Starts
          </label>
          <input
            id="event-start"
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="input w-full"
          />
        </div>
        <div>
          <label htmlFor="event-end" className="mb-1 block text-sm font-medium text-gray-900">
            Ends
          </label>
          <input
            id="event-end"
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="input w-full"
          />
        </div>
      </div>

      <div>
        <label htmlFor="event-description" className="mb-1 block text-sm font-medium text-gray-900">
          What should people know?
        </label>
        <textarea
          id="event-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          maxLength={5000}
          placeholder="Bring something broken and we&apos;ll try to fix it together."
          className="input w-full"
        />
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-gray-900">Who can see it?</legend>
        <div className="space-y-2">
          {VISIBILITIES.map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                visibility === option.value
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input
                type="radio"
                name="visibility"
                value={option.value}
                checked={visibility === option.value}
                onChange={(e) => setVisibility(e.target.value)}
                className="mt-1"
              />
              <span>
                <span className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                  <option.icon className="h-4 w-4 text-gray-400" />
                  {option.label}
                </span>
                <span className="mt-0.5 block text-xs text-gray-500">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {hosts && (
        <div>
          <label htmlFor="event-host" className="mb-1 block text-sm font-medium text-gray-900">
            Who is running it?
          </label>
          <select
            id="event-host"
            value={hostId}
            onChange={(e) => setHostId(e.target.value)}
            className="input w-full"
          >
            <option value="">You</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            They get the post-event follow-up and can edit the event themselves.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="event-capacity" className="mb-1 block text-sm font-medium text-gray-900">
            Limit on numbers
          </label>
          <input
            id="event-capacity"
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder="No limit"
            className="input w-full"
          />
        </div>
        <div>
          <label htmlFor="event-category" className="mb-1 block text-sm font-medium text-gray-900">
            Category
          </label>
          <input
            id="event-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Workshop"
            className="input w-full"
          />
        </div>
      </div>

      {/*
        The switch that was missing (EVT-02). The waitlist engine has worked
        since EventOS was built — over capacity a guest is WAITLISTED, and
        cancelling a confirmed place promotes the first person waiting — but
        nothing in the product ever set this column, so it stayed false and the
        engine could never run. The landing page has sold it the whole time.

        Disabled rather than hidden when there is no limit: an event that
        cannot fill cannot overflow, and showing the dependency teaches it
        better than making the control disappear.
      */}
      <div>
        <label className="flex items-start gap-2.5">
          <input
            id="event-waitlist"
            type="checkbox"
            checked={Boolean(capacity) && waitlist}
            disabled={!capacity}
            onChange={(e) => setWaitlist(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 disabled:opacity-40"
          />
          <span className="text-sm">
            <span
              className={`font-medium ${capacity ? 'text-gray-900' : 'text-gray-400'}`}
            >
              Keep a waitlist once it is full
            </span>
            <span className="mt-0.5 block text-xs text-gray-500">
              {capacity
                ? 'People can still sign up after it fills, and the first one waiting takes any place that frees up.'
                : 'Set a limit on numbers first — an event with no limit never fills.'}
            </span>
          </span>
        </label>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-gray-900">Tickets</legend>
        <div className="space-y-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 p-3 hover:border-gray-300">
            <input
              type="radio"
              name="ticketed"
              checked={!ticketed}
              onChange={() => setTicketed(false)}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-gray-900">Free</span>
              <span className="mt-0.5 block text-xs text-gray-500">
                People RSVP and turn up. No payment involved.
              </span>
            </span>
          </label>

          <label
            className={`flex items-start gap-3 rounded-xl border p-3 ${
              canSellTickets
                ? 'cursor-pointer border-gray-200 hover:border-gray-300'
                : 'cursor-not-allowed border-gray-200 opacity-60'
            }`}
          >
            <input
              type="radio"
              name="ticketed"
              checked={ticketed}
              disabled={!canSellTickets}
              onChange={() => setTicketed(true)}
              className="mt-1"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-gray-900">
                Sell tickets
              </span>
              {canSellTickets ? (
                <span className="mt-0.5 block text-xs text-gray-500">
                  You&apos;re paid directly by Stripe. Fees are added on top of your
                  price, so you receive what you set.
                </span>
              ) : (
                // Naming the reason and who can fix it beats a disabled control
                // with no explanation.
                <span className="mt-0.5 block text-xs text-gray-500">
                  Your co-op hasn&apos;t finished setting up payments yet. An admin can
                  do that in Settings.
                </span>
              )}
            </span>
          </label>
        </div>

        {ticketed && (
          <div className="mt-3">
            <label
              htmlFor="event-price"
              className="mb-1 block text-sm font-medium text-gray-900"
            >
              Ticket price
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">$</span>
              <input
                id="event-price"
                type="number"
                min="0.50"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="10.00"
                className="input w-32"
              />
            </div>
            {/* What the buyer actually pays, spelled out. A price that turns
                out to be higher at checkout is the thing people resent most
                about ticketing platforms. */}
            <p className="mt-2 text-xs text-gray-500">
              {Number(price) > 0 ? (
                <>
                  You receive <strong>{money(Math.round(Number(price) * 100))}</strong>.
                  Buyers pay{' '}
                  <strong>
                    {money(
                      Math.round(Number(price) * 100) +
                        (PLATFORM_FEE_CENTS[plan] ?? 55) +
                        orgFeeCents,
                    )}
                  </strong>{' '}
                  — {money(PLATFORM_FEE_CENTS[plan] ?? 55)} MaybeOS fee
                  {orgFeeCents > 0 ? `, ${money(orgFeeCents)} your co-op's fee` : ''}.
                </>
              ) : (
                <>Fees are added on top, so you receive the price you set.</>
              )}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              If you cancel, everyone is refunded in full — but Stripe keeps its
              processing fee, so cancelling a sold-out event costs your co-op money.
            </p>
          </div>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 pt-4">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Saving...' : submitLabel}
        </button>
        {/* Saving without publishing is what lets somebody write a description
            over two sittings without broadcasting a half-finished event.

            Hidden once an event is published, because there is no unpublish:
            the button would claim to withdraw something it cannot, which is
            the same kind of lie the visibility badge was telling. */}
        {!alreadyPublished && (
          <button
            type="button"
            onClick={(e) => submit(e, false)}
            className="btn-secondary"
            disabled={busy}
          >
            Save as draft
          </button>
        )}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-gray-500 hover:text-gray-900"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
