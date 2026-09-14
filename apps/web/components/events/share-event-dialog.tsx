'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ShareOptions, ShareResult, SocialPlatform } from '@/lib/api';
import { instagramJpeg } from '@/lib/instagram-image';
import { Modal } from '@/components/ui/modal';

const NAMES: Record<SocialPlatform, string> = { FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram' };

/**
 * A host sharing their event to the co-op's Facebook Page and Instagram (SOC-01).
 *
 * The host edits the words. Their credit and the RSVP link are added by the
 * server and shown here as they will appear. The picture is cropped to fit
 * Instagram in the browser, so the host sees exactly what goes out.
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
  const [jpeg, setJpeg] = useState<{ base64: string; dataUrl: string } | null>(null);
  const [jpegState, setJpegState] = useState<'none' | 'working' | 'ready' | 'failed'>('none');
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
        setChosen({ FACEBOOK: Boolean(o.facebook && !o.facebook.post), INSTAGRAM: false });
        if (o.instagram && !o.instagram.post && o.imageUrl) {
          setJpegState('working');
          instagramJpeg(o.imageUrl).then((result) => {
            setJpeg(result);
            setJpegState(result ? 'ready' : 'failed');
            if (result) setChosen((c) => ({ ...c, INSTAGRAM: true }));
          });
        }
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Could not load sharing options'));
  }, [orgId, eventId, token]);

  async function share() {
    const platforms = (Object.keys(chosen) as SocialPlatform[]).filter((p) => chosen[p]);
    if (platforms.length === 0) return;
    setPosting(true);
    setError('');
    try {
      const { results: done } = await api.social.share(
        orgId,
        eventId,
        { platforms, body, ...(jpeg && { image: jpeg.base64 }) },
        token,
      );
      setResults(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not share just now');
    } finally {
      setPosting(false);
    }
  }

  const igAvailable = Boolean(options?.instagram && !options.instagram.post && jpegState === 'ready');
  const fbAvailable = Boolean(options?.facebook && !options.facebook.post);
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
            <fieldset className="space-y-2">
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
                    {options.facebook.post && (
                      <SharedNote permalink={options.facebook.post.permalink} />
                    )}
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
                    {options.instagram.post ? (
                      <SharedNote permalink={options.instagram.post.permalink} />
                    ) : options.instagram.needsImage ? (
                      <span className="block text-xs text-gray-500">Instagram needs a picture. Add one to the event first.</span>
                    ) : jpegState === 'working' ? (
                      <span className="block text-xs text-gray-500">Preparing the picture…</span>
                    ) : jpegState === 'failed' ? (
                      <span className="block text-xs text-amber-800">
                        This picture can&apos;t be prepared for Instagram because it&apos;s hosted on another site. Edit the
                        event and upload the picture instead.
                      </span>
                    ) : null}
                  </span>
                </label>
              )}
            </fieldset>

            {jpeg && chosen.INSTAGRAM && (
              <div>
                <p className="mb-1 font-medium text-gray-900">Picture</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={jpeg.dataUrl} alt="The picture as it will be posted" className="max-h-64 rounded-lg border border-gray-200" />
              </div>
            )}

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
              disabled={posting || !anyChosen || !body.trim()}
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
