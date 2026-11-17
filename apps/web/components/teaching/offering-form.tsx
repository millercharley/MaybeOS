'use client';

import { useState, FormEvent } from 'react';
import { GraduationCap, Users } from 'lucide-react';
import { RichComposer, composerValue } from '@/components/composer/rich-composer';
import { MIN_PRICE_CENTS, priceFromInput, priceToInput } from '@/lib/teaching';
import type { Offering, OfferingInput, OfferingKind, OfferingPayment } from '@/lib/api';

/**
 * Writing up what you teach (TCH-01).
 *
 * **The kind is the first question and it changes the form**, because it
 * changes what the thing is. A workshop has dates, or will have; a private
 * lesson is a standing offer that each learner arranges for themselves. Asking
 * for a schedule on something that has none is how a form teaches somebody
 * that the product does not understand what they are doing.
 *
 * Dates are *not* asked for here. A workshop's sessions are events, added one
 * at a time after the offering exists — which is the same shape as attaching
 * a file to a post: the parent has to exist before anything can point at it.
 *
 * The description uses the same composer as everything else a member writes,
 * so pasting a formatted outline from a document keeps its bold and its links
 * (CMP-01).
 */
export function OfferingForm({
  existing,
  onSave,
  onCancel,
  busy,
}: {
  existing?: Offering;
  onSave: (body: OfferingInput) => Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}) {
  const [kind, setKind] = useState<OfferingKind>(existing?.kind ?? 'WORKSHOP');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [summary, setSummary] = useState(existing?.summary ?? '');
  const [body, setBody] = useState(existing?.richDescription ?? '');
  const [visibility, setVisibility] = useState(existing?.visibility ?? 'MEMBERS_ONLY');
  const [payment, setPayment] = useState<OfferingPayment>(
    existing?.payment ?? 'ARRANGE_DIRECTLY',
  );
  const [price, setPrice] = useState(priceToInput(existing?.priceCents));
  const [priceNote, setPriceNote] = useState(existing?.priceNote ?? '');
  const [error, setError] = useState('');

  /*
    Paid private lessons are the half of TCH-01 that is not built yet, so the
    option is absent rather than present-and-broken. A control that offers
    something the server refuses is worse than one that does not offer it:
    the member fills the whole form in before finding out.
  */
  const mayCharge = kind === 'WORKSHOP';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');

    const cents = priceFromInput(price);
    if (payment === 'THROUGH_MAYBEOS' && mayCharge && cents === 'invalid') {
      setError(`Give a price of at least $${(MIN_PRICE_CENTS / 100).toFixed(2)}, or let people arrange it with you.`);
      return;
    }

    await onSave({
      kind,
      title: title.trim(),
      summary: summary.trim() || undefined,
      richDescription: composerValue(body) || undefined,
      visibility,
      payment: mayCharge ? payment : 'ARRANGE_DIRECTLY',
      priceCents: payment === 'THROUGH_MAYBEOS' && mayCharge && cents !== 'invalid' ? cents : null,
      priceNote: priceNote.trim() || undefined,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {/* What this is. First, because it changes the rest of the form. */}
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-gray-700">What are you offering?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <KindChoice
            chosen={kind === 'WORKSHOP'}
            onChoose={() => setKind('WORKSHOP')}
            icon={Users}
            label="A workshop"
            blurb="One or more sessions, for a group. Add the dates next — or leave them off and gather interest first."
          />
          <KindChoice
            chosen={kind === 'PRIVATE_LESSON'}
            onChoose={() => setKind('PRIVATE_LESSON')}
            icon={GraduationCap}
            label="Private lessons"
            blurb="A standing offer. People get in touch and you arrange a time between you."
          />
        </div>
      </fieldset>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Title</span>
        <input
          className="input w-full"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={kind === 'WORKSHOP' ? 'Beginner wheel throwing' : 'Piano lessons, all ages'}
          required
          maxLength={200}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">
          One line <span className="font-normal text-gray-400">— what people see on a card</span>
        </span>
        <input
          className="input w-full"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Four Tuesdays, no experience needed, clay included."
          maxLength={300}
        />
      </label>

      <div>
        <span className="mb-1 block text-sm font-medium text-gray-700">Tell people about it</span>
        <RichComposer
          value={body}
          onChange={setBody}
          placeholder="What you will cover, what to bring, who it is for…"
          rows={6}
        />
      </div>

      {/* Who sees it. Members-only by default, and the copy says so. */}
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Who can see this</span>
        <select
          className="input w-full"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as typeof visibility)}
        >
          <option value="MEMBERS_ONLY">Members of this co-op</option>
          <option value="PUBLIC">Anyone, including on the co-op&rsquo;s website</option>
          <option value="PRIVATE">Nobody — keep it off the lists for now</option>
        </select>
        <span className="mt-1 block text-xs text-gray-500">
          {visibility === 'PUBLIC'
            ? 'This appears on the co-op’s public teaching page and anywhere they embed it.'
            : visibility === 'MEMBERS_ONLY'
              ? 'Only people signed in to this co-op will find it.'
              : 'It stays off every list. You can still send somebody the link.'}
        </span>
      </label>

      {/* Money. */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-gray-700">Money</legend>

        {mayCharge ? (
          <select
            className="input w-full"
            value={payment}
            onChange={(e) => setPayment(e.target.value as OfferingPayment)}
          >
            <option value="ARRANGE_DIRECTLY">Free, or arranged between us</option>
            <option value="THROUGH_MAYBEOS">Sell tickets through MaybeOS</option>
          </select>
        ) : (
          <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
            People arrange payment with you directly. MaybeOS cannot take payment for private
            lessons yet — say below what you charge, and the two of you settle it.
          </p>
        )}

        {mayCharge && payment === 'THROUGH_MAYBEOS' ? (
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">Price per ticket</span>
            <input
              className="input w-full"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="40.00"
            />
            <span className="mt-1 block text-xs text-gray-500">
              You set this per session when you add the dates. This is the one people see on the
              card before they open it.
            </span>
          </label>
        ) : (
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">
              What you charge <span className="text-gray-400">— in your own words</span>
            </span>
            <input
              className="input w-full"
              value={priceNote}
              onChange={(e) => setPriceNote(e.target.value)}
              placeholder="Sliding scale, $30–60. First lesson free."
              maxLength={300}
            />
          </label>
        )}
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn-primary" disabled={busy || !title.trim()}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Create'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function KindChoice({
  chosen,
  onChoose,
  icon: Icon,
  label,
  blurb,
}: {
  chosen: boolean;
  onChoose: () => void;
  icon: typeof Users;
  label: string;
  blurb: string;
}) {
  return (
    <button
      type="button"
      onClick={onChoose}
      aria-pressed={chosen}
      className={`rounded-xl border p-4 text-left transition-colors ${
        chosen
          ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-400'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <Icon className={`h-5 w-5 ${chosen ? 'text-brand-700' : 'text-gray-400'}`} />
      <span className="mt-2 block text-sm font-semibold text-gray-900">{label}</span>
      <span className="mt-1 block text-xs leading-relaxed text-gray-500">{blurb}</span>
    </button>
  );
}
