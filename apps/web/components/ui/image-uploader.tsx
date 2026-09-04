'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { ImageCropper } from '@/components/ui/image-cropper';

/**
 * What this will attempt to open, not what the API stores.
 *
 * These two used to be the same number, and since SPC-17 they are different
 * questions. What lands on the server is the *cropped* image, capped at 1600px
 * on its long edge and re-encoded — a few hundred kilobytes whatever came in.
 * So the only thing this limit protects is the browser: decoding a very large
 * photograph into a canvas is memory a phone may not have.
 *
 * Generous, therefore. Rejecting a 12 MB photo straight off a camera would
 * defeat the point of shrinking it.
 */
const MAX_BYTES = 25 * 1024 * 1024;
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
  aspect = 3 / 2,
  onUpload,
  onRemove,
}: {
  imageUrl: string | null | undefined;
  /** What these images are called, for the size message. */
  what?: string;
  /** The empty-state button. Says what this particular image is. */
  addLabel?: string;
  /**
   * The shape the image is shown in, and so the shape it is cropped to
   * (SPC-17). Matching the two is the point: what the co-op crops is what
   * members see, rather than a centre-crop of it made later by CSS.
   */
  aspect?: number;
  onUpload: (data: string, mimeType: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  // The file waiting to be cropped. Nothing is uploaded until it is.
  const [cropping, setCropping] = useState<File | null>(null);

  const choose = async (file: File) => {
    setProblem('');

    if (!ACCEPTED.includes(file.type)) {
      setProblem('That needs to be a PNG, JPEG, WebP or GIF.');
      return;
    }
    if (file.size > MAX_BYTES) {
      // Named in the units somebody's photo library uses, not in bytes.
      setProblem(
        `That is ${(file.size / 1024 / 1024).toFixed(1)} MB, which is too large to open here. ` +
          `${what} have to be under ${MAX_BYTES / 1024 / 1024} MB.`,
      );
      return;
    }

    // Straight to the cropper rather than to the network. The upload happens
    // on the way out of it, from a picture that has been cropped and shrunk
    // (SPC-17) — which also keeps a phone photograph under the request limit
    // the base64 body would otherwise blow through.
    setCropping(file);
    if (input.current) input.current.value = '';
  };

  return (
    <div>
      {cropping && (
        <ImageCropper
          file={cropping}
          aspect={aspect}
          onCancel={() => setCropping(null)}
          onDone={async ({ dataUrl, mimeType }) => {
            setBusy(true);
            setProblem('');
            try {
              await onUpload(dataUrl, mimeType);
              setCropping(null);
            } catch (err) {
              setProblem(err instanceof Error ? err.message : 'That did not upload');
              setCropping(null);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

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
