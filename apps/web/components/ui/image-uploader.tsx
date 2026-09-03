'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';

/** Kept in step with the API, which is the one that actually enforces it. */
const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/**
 * Picking an image, for anything that carries one.
 *
 * Started as the article cover uploader and moved here when rooms needed the
 * same thing (SPC-16): the size limit, the sniffing, the signed-URL preview
 * and the failure messages are identical, and a second copy would be a second
 * place for them to drift out of step with what the bucket accepts.
 *
 * Checked here *and* on the server, and the two say the same thing. The
 * client check exists so somebody who picks a 40 MB photo from their phone
 * finds out immediately rather than after uploading it; the server check is
 * the one that matters, because this one is a courtesy anybody can skip.
 *
 * The preview is the signed URL the API hands back, which expires — so this
 * shows the co-op exactly what a member will see, including the fact that it
 * is not a link anyone can pass around.
 */
export function ImageUploader({
  imageUrl,
  what = 'Images',
  addLabel = 'Add an image',
  onUpload,
  onRemove,
}: {
  imageUrl: string | null | undefined;
  /** What these images are called, for the size message. */
  what?: string;
  /** The empty-state button. Says what this particular image is. */
  addLabel?: string;
  onUpload: (data: string, mimeType: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const choose = async (file: File) => {
    setProblem('');

    if (!ACCEPTED.includes(file.type)) {
      setProblem('That needs to be a PNG, JPEG, WebP or GIF.');
      return;
    }
    if (file.size > MAX_BYTES) {
      // Named in the units somebody's photo library uses, not in bytes.
      setProblem(
        `That is ${(file.size / 1024 / 1024).toFixed(1)} MB. ${what} have to be under ${
          MAX_BYTES / 1024 / 1024
        } MB.`,
      );
      return;
    }

    setBusy(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Could not read that file'));
        reader.readAsDataURL(file);
      });
      await onUpload(data, file.type);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not upload');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept={ACCEPTED.join(',')}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) choose(file);
        }}
      />

      {imageUrl ? (
        <div className="relative overflow-hidden rounded-xl border border-gray-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="max-h-56 w-full object-cover" />
          <div className="absolute right-2 top-2 flex gap-2">
            <button
              onClick={() => input.current?.click()}
              disabled={busy}
              className="rounded-lg bg-white/90 px-3 py-1.5 text-xs font-medium text-gray-800 shadow hover:bg-white"
            >
              Replace
            </button>
            <button
              onClick={async () => {
                setBusy(true);
                try {
                  await onRemove();
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              aria-label="Remove cover"
              className="rounded-lg bg-white/90 p-1.5 text-gray-600 shadow hover:bg-white hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => input.current?.click()}
          disabled={busy}
          className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 py-8 text-sm text-gray-500 hover:border-brand-400 hover:text-gray-700"
        >
          {busy ? (
            <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
          ) : (
            <ImagePlus className="h-6 w-6 text-gray-400" />
          )}
          {busy ? 'Uploading…' : addLabel}
        </button>
      )}

      <p className="mt-2 text-xs text-gray-500">
        {/* Said out loud, because a co-op putting a photo of its members on a
            page has a fair question about who can see it. */}
        Only members of this community can see it — the link expires and
        can&rsquo;t be passed around.
      </p>

      {problem && <p className="mt-2 text-sm text-red-700">{problem}</p>}
    </div>
  );
}
