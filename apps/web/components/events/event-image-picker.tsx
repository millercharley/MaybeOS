'use client';

import { useEffect, useState } from 'react';
import { ImagePlus, Link2, Search, X, Loader2 } from 'lucide-react';
import { api, EventImageSources, UnsplashPhoto } from '@/lib/api';
import { ImageUploader } from '@/components/ui/image-uploader';

/**
 * A picture for an event, from wherever the organiser has one (EVT-22).
 *
 * Three sources, because organisers have pictures in three places: a photo of
 * last time on their phone, a poster already hosted somewhere, and nothing at
 * all — which is the common case and the one Unsplash answers.
 *
 * Unsplash needs an access key, so the tab appears only when the server has
 * one. A tab that opens and explains it is not configured is worse than two
 * tabs that work, and the two that work are enough on their own.
 *
 * The credit travels with the URL rather than being asked for separately:
 * Unsplash's terms require the photographer's name and a link wherever the
 * photo appears, so the picker is where both are captured, and picking any
 * other source clears them — a credit left behind from a previous choice
 * would attribute an organiser's own photo to a stranger.
 */

export interface EventImageValue {
  imageUrl: string;
  imageCredit: string;
  imageCreditUrl: string;
}

export const NO_IMAGE: EventImageValue = { imageUrl: '', imageCredit: '', imageCreditUrl: '' };

type Tab = 'upload' | 'url' | 'unsplash';

export function EventImagePicker({
  orgId,
  token,
  value,
  onChange,
}: {
  orgId: string;
  token: string;
  value: EventImageValue;
  onChange: (next: EventImageValue) => void;
}) {
  const [sources, setSources] = useState<EventImageSources | null>(null);
  const [tab, setTab] = useState<Tab>('upload');
  const [urlDraft, setUrlDraft] = useState('');
  const [problem, setProblem] = useState('');

  useEffect(() => {
    if (!orgId || !token) return;
    api.events
      .imageSources(orgId, token)
      // Upload and URL work regardless; only the Unsplash tab depends on this,
      // so a failure here costs the tab rather than the picker.
      .catch(() => ({ upload: true, url: true, unsplash: false }))
      .then(setSources);
  }, [orgId, token]);

  function choose(next: EventImageValue) {
    setProblem('');
    onChange(next);
  }

  function submitUrl() {
    const address = urlDraft.trim();
    if (!address) return;
    if (!/^https?:\/\/\S+$/i.test(address)) {
      // The API refuses anything else too; saying so here means somebody
      // pasting a `data:` URL finds out before they save the whole event.
      setProblem('That needs to be a web address starting with http:// or https://');
      return;
    }
    // No credit: a URL somebody pastes has nobody attached to it.
    choose({ imageUrl: address, imageCredit: '', imageCreditUrl: '' });
    setUrlDraft('');
  }

  const tabs: { id: Tab; label: string; icon: typeof ImagePlus }[] = [
    { id: 'upload', label: 'Upload', icon: ImagePlus },
    { id: 'url', label: 'Web address', icon: Link2 },
    ...(sources?.unsplash ? [{ id: 'unsplash' as const, label: 'Unsplash', icon: Search }] : []),
  ];

  return (
    <div className="space-y-3">
      {value.imageUrl ? (
        <figure className="relative overflow-hidden rounded-xl border border-gray-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value.imageUrl}
            alt=""
            className="aspect-[3/2] w-full bg-gray-50 object-cover"
          />
          <button
            type="button"
            onClick={() => choose(NO_IMAGE)}
            className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 text-gray-600 shadow hover:bg-white hover:text-gray-900"
            aria-label="Remove this picture"
          >
            <X className="h-4 w-4" />
          </button>
          {value.imageCredit && (
            <figcaption className="px-3 py-2 text-xs text-gray-500">
              Photo by{' '}
              {value.imageCreditUrl ? (
                <a
                  href={value.imageCreditUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline"
                >
                  {value.imageCredit}
                </a>
              ) : (
                value.imageCredit
              )}{' '}
              on Unsplash
            </figcaption>
          )}
        </figure>
      ) : (
        <p className="text-sm text-gray-500">
          No picture yet. Events without one get generated artwork.
        </p>
      )}

      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === id
                ? 'border-b-2 border-brand-600 text-brand-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {problem && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {problem}
        </p>
      )}

      {tab === 'upload' && (
        <ImageUploader
          what="Event pictures"
          addLabel={value.imageUrl ? 'Upload a different picture' : 'Upload a picture'}
          // Always null: the preview above belongs to the picker, which shows
          // the chosen image whichever tab it came from. Passing it here would
          // draw a second preview with a Remove button that removes a
          // different thing.
          imageUrl={null}
          aspect={3 / 2}
          onUpload={async (data, mimeType) => {
            const { url } = await api.events.uploadImage(orgId, data, mimeType, token);
            choose({ imageUrl: url, imageCredit: '', imageCreditUrl: '' });
          }}
          onRemove={async () => choose(NO_IMAGE)}
        />
      )}

      {/* A `div`, not a `form`. This whole picker renders *inside* the event
          form, and a form inside a form is invalid HTML — which leaves which
          form a submit button belongs to up to the browser. Enter is handled
          here instead, so the key does what it looks like it does and never
          reaches the event form. */}
      {tab === 'url' && (
        <div className="flex flex-wrap gap-2">
          <input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              submitUrl();
            }}
            placeholder="https://example.com/poster.jpg"
            className="input min-w-0 flex-1"
            aria-label="Picture web address"
          />
          <button
            type="button"
            onClick={submitUrl}
            disabled={!urlDraft.trim()}
            className="btn-secondary text-sm"
          >
            Use this
          </button>
        </div>
      )}

      {tab === 'unsplash' && (
        <UnsplashTab orgId={orgId} token={token} onPick={choose} />
      )}
    </div>
  );
}

/**
 * Searching Unsplash, through MaybeOS's proxy.
 *
 * Nothing is downloaded and rehosted: the stored address is Unsplash's own
 * CDN, which is what their terms ask for. Picking one also tells them it was
 * used — a requirement of using the API, and a request whose failure is
 * deliberately ignored, because the organiser has chosen their picture either
 * way.
 */
function UnsplashTab({
  orgId,
  token,
  onPick,
}: {
  orgId: string;
  token: string;
  onPick: (value: EventImageValue) => void;
}) {
  const [query, setQuery] = useState('');
  const [photos, setPhotos] = useState<UnsplashPhoto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  async function search() {
    if (!query.trim()) return;
    setBusy(true);
    setProblem('');
    try {
      const { photos: found } = await api.events.searchUnsplash(orgId, query.trim(), token);
      setPhotos(found);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not search Unsplash');
    } finally {
      setBusy(false);
    }
  }

  function pick(photo: UnsplashPhoto) {
    onPick({
      imageUrl: photo.url,
      imageCredit: photo.photographer,
      imageCreditUrl: photo.photographerUrl,
    });
    if (photo.downloadLocation) {
      api.events.unsplashUsed(orgId, photo.downloadLocation, token).catch(() => {
        // Their analytics ping, not the organiser's problem.
      });
    }
  }

  return (
    <div className="space-y-3">
      {/* Also a `div`, for the same reason: no nested forms, and Enter must
          search rather than save the event being written. */}
      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            search();
          }}
          placeholder="pottery, potluck, live music…"
          maxLength={100}
          className="input min-w-0 flex-1"
          aria-label="Search Unsplash"
        />
        <button
          type="button"
          onClick={search}
          disabled={busy || !query.trim()}
          className="btn-secondary text-sm"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
        </button>
      </div>

      {problem && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {problem}
        </p>
      )}

      {photos?.length === 0 && (
        <p className="py-4 text-center text-sm text-gray-400">Nothing found for that.</p>
      )}

      {photos && photos.length > 0 && (
        <ul className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto">
          {photos.map((photo) => (
            <li key={photo.id}>
              <button
                type="button"
                onClick={() => pick(photo)}
                className="group block w-full overflow-hidden rounded-lg border border-gray-200 hover:border-brand-400"
                title={`Photo by ${photo.photographer}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.thumbUrl}
                  alt={photo.description}
                  className="aspect-[3/2] w-full bg-gray-50 object-cover"
                />
                <span className="block truncate px-1.5 py-1 text-left text-[11px] text-gray-500">
                  {photo.photographer}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-gray-400">
        Photos from Unsplash. The photographer is credited on the event.
      </p>
    </div>
  );
}
