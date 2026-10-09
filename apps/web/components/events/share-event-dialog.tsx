'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ImagePlus, RefreshCw } from 'lucide-react';
import { api, ShareOptions, ShareResult, SocialPlatform } from '@/lib/api';
import { prepareFromBlob, prepareFromUrl, type Prepared } from '@/lib/instagram-image';
import { Modal } from '@/components/ui/modal';

const NAMES: Record<SocialPlatform, string> = { FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram' };

/** What the file picker will offer. HEIC is listed so a phone can hand one over and be told. */
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

/**
 * A host sharing their event to the co-op's Facebook Page and Instagram
 * (SOC-01, with the picture step added in SOC-03).
 *
 * **The picture comes first, and there is always one.** Charley: "ask the
 * user for an image. Supply the existing image attached to the event IF
 * there is one, and allow for the user to choose to use a different image if
 * desired."
 *
 * It used to take whatever picture the event happened to carry and offer no
 * way to supply another — so an event with no picture simply could not go to
 * Instagram ("Add one to the event first"), and a picture the browser was
 * not allowed to read was the same dead end. Both are now a file away.
 *
 * Everything is re-encoded to a JPEG inside Instagram's 4:5–1.91:1 range
 * before it leaves the browser, because that is what the content publishing
 * API takes and because the host should see exactly what goes out. The API
 * checks it again — format, ratio, width and size — since a browser is not
 * a trusted source.
 */
export function ShareEventDialog({
  orgId,
  orgSlug,
  token,
  eventId,
  onClose,
}: {
  orgId: string;
  orgSlug: string;
  token: string;
  eventId: string;
  onClose: () => void;
}) {
  const [options, setOptions] = useState<ShareOptions | null>(null);
  const [loadError, setLoadError] = useState('');
  const [body, setBody] = useState('');

  /** The picture, once there is one that will post. */
  const [image, setImage] = useState<Prepared | null>(null);
  /** Where it came from, so the host can tell the event's from their own. */
  const [source, setSource] = useState<'event' | 'chosen' | null>(null);
  const [preparing, setPreparing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [chosen, setChosen] = useState<Record<SocialPlatform, boolean>>({ FACEBOOK: false, INSTAGRAM: false });
  const [posting, setPosting] = useState(false);
  const [results, setResults] = useState<ShareResult[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.social
      .shareOptions(orgId, eventId, token)
      .then((o) => {
        setOptions(o);
        setBody(o.body);
        setChosen({
          FACEBOOK: Boolean(o.facebook && !o.facebook.post),
          INSTAGRAM: Boolean(o.instagram && !o.instagram.post),
        });

        // The event's own picture, offered as the one to use. Not a
        // requirement any more — just a head start on the common case.
        if (o.imageUrl) {
          setPreparing(true);
          prepareFromUrl(o.imageUrl).then((prepared) => {
            setPreparing(false);
            setImage(prepared);
            setSource('event');
          });
        }
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Could not load sharing options'));
  }, [orgId, eventId, token]);

  async function choose(file: File | undefined) {
    if (!file) return;
    setPreparing(true);
    setError('');
    const prepared = await prepareFromBlob(file);
    setPreparing(false);
    setImage(prepared);
    setSource('chosen');
  }

  async function share() {
    const platforms = (Object.keys(chosen) as SocialPlatform[]).filter((p) => chosen[p]);
    if (platforms.length === 0 || !image?.ok) return;
    setPosting(true);
    setError('');
    try {
      const { results: done } = await api.social.share(
        orgId,
        eventId,
        { platforms, body, image: image.base64 },
        token,
      );
      setResults(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not share just now');
    } finally {
      setPosting(false);
    }
  }

  const ready = Boolean(image?.ok);
  const igAvailable = Boolean(options?.instagram && !options.instagram.post && ready);
  const fbAvailable = Boolean(options?.facebook && !options.facebook.post && ready);
  const anyChosen = chosen.FACEBOOK || chosen.INSTAGRAM;

  return (
    <Modal open onClose={onClose} title="Share to Facebook & Instagram">
      <div className="max-h-[75vh] space-y-4 overflow-y-auto pr-1 text-sm">
        {loadError && <p className="rounded-lg bg-red-50 p-3 text-red-700">{loadError}</p>}
        {!options && !loadError && <p className="text-gray-500">Loading…</p>}

        {options && !options.canShare && (
          <p className="rounded-lg bg-gray-50 p-3 text-gray-700">{options.reason}</p>
        )}

        {options && options.canShare && results && (
          <div className="space-y-2">
            {results.map((r) => (
              <div
                key={r.platform}
                className={`rounded-lg p-3 ${r.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}
              >
                <p className="font-medium">
                  {r.ok ? `Posted to ${NAMES[r.platform]}.` : `${NAMES[r.platform]}: ${r.error}`}
                </p>
                {r.permalink && (
                  <a href={r.permalink} target="_blank" rel="noopener noreferrer" className="underline">
                    View the post
                  </a>
                )}
                {r.platform === 'INSTAGRAM' && r.ok && r.collaboratorInvited && (
                  <p className="mt-1">Accept the collaborator invite in Instagram to show it on your profile too.</p>
                )}
              </div>
            ))}
            <button type="button" onClick={onClose} className="btn-primary w-full text-sm">
              Done
            </button>
          </div>
        )}

        {options && options.canShare && !results && (
          <>
            {/* The picture, first and always (SOC-03): it is the one thing
                Instagram will not post without, and the thing the host most
                wants to see before it goes out. */}
            <section className="space-y-2">
              <p className="font-medium text-gray-900">Picture</p>

              <input
                ref={fileInput}
                type="file"
                accept={ACCEPT}
                className="sr-only"
                onChange={(e) => {
                  void choose(e.target.files?.[0]);
                  // Cleared, so picking the same file twice still fires.
                  e.target.value = '';
                }}
              />

              {preparing && <p className="text-gray-500">Preparing the picture…</p>}

              {!preparing && image?.ok && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.dataUrl}
                    alt="The picture as it will be posted"
                    className="max-h-64 rounded-lg border border-gray-200"
                  />
                  <p className="text-xs text-gray-500">
                    {source === 'event' ? 'The event’s picture' : 'Your picture'} · cropped to{' '}
                    {image.width}&nbsp;×&nbsp;{image.height} for Instagram
                  </p>
                </>
              )}

              {!preparing && image && !image.ok && (
                <p className="rounded-lg bg-amber-50 p-3 text-amber-900">{image.reason}</p>
              )}

              {!preparing && !image && (
                <p className="text-gray-500">
                  Choose a picture to post. Instagram will not take a post without one.
                </p>
              )}

              {!preparing && (
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={posting}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {image?.ok ? (
                    <>
                      <RefreshCw className="h-4 w-4" /> Use a different picture
                    </>
                  ) : (
                    <>
                      <ImagePlus className="h-4 w-4" /> Choose a picture
                    </>
                  )}
                </button>
              )}
            </section>

            <fieldset className="space-y-2 border-t border-gray-100 pt-4">
              <legend className="mb-1 font-medium text-gray-900">Where</legend>

              {options.facebook && (
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={chosen.FACEBOOK}
                    disabled={!fbAvailable || posting}
                    onChange={(e) => setChosen((c) => ({ ...c, FACEBOOK: e.target.checked }))}
                  />
                  <span>
                    Facebook: {options.facebook.pageName}
                    {options.facebook.post && <SharedNote permalink={options.facebook.post.permalink} />}
                  </span>
                </label>
              )}

              {options.instagram && (
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={chosen.INSTAGRAM}
                    disabled={!igAvailable || posting}
                    onChange={(e) => setChosen((c) => ({ ...c, INSTAGRAM: e.target.checked }))}
                  />
                  <span>
                    Instagram: @{options.instagram.username}
                    {options.instagram.post && <SharedNote permalink={options.instagram.post.permalink} />}
                  </span>
                </label>
              )}

              {!ready && !preparing && (
                <p className="text-xs text-gray-500">Choose a picture above to post.</p>
              )}
            </fieldset>

            <div>
              <label htmlFor="share-body" className="mb-1 block font-medium text-gray-900">
                Post
              </label>
              <textarea
                id="share-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                maxLength={1800}
                disabled={posting}
                className="input w-full text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">Added after your text:</p>
              <pre className="mt-1 whitespace-pre-wrap rounded-md bg-gray-50 p-2 font-sans text-xs text-gray-600">
                {chosen.INSTAGRAM && !chosen.FACEBOOK ? options.instagramCredit : options.facebookCredit}
              </pre>
              {!options.credit.instagramHandle && (
                <p className="mt-1 text-xs text-gray-500">
                  Add your Instagram username on{' '}
                  <Link href={`/member/${orgSlug}/profile`} className="underline">
                    your profile
                  </Link>{' '}
                  to be credited and invited as a collaborator.
                </p>
              )}
            </div>

            {error && <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}

            <button
              type="button"
              onClick={share}
              disabled={posting || preparing || !ready || !anyChosen || !body.trim()}
              className="btn-primary w-full text-sm disabled:opacity-50"
            >
              {posting ? 'Posting…' : 'Post now'}
            </button>
            <p className="text-center text-xs text-gray-500">Posts go out straight away to the co-op&apos;s accounts.</p>
          </>
        )}
      </div>
    </Modal>
  );
}

function SharedNote({ permalink }: { permalink: string | null }) {
  return (
    <span className="block text-xs text-green-700">
      Already shared.{' '}
      {permalink && (
        <a href={permalink} target="_blank" rel="noopener noreferrer" className="underline">
          View the post
        </a>
      )}
    </span>
  );
}
