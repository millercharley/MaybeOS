'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { api, type SupportArticle } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Writing MaybeOS's documentation (PLT-05).
 *
 * Charley: "make sure that I, as a Super Admin, can edit the articles and add
 * additional screenshots."
 *
 * A plain HTML body rather than a rich editor. These articles are written by
 * one person who knows what `<h3>` means, they ship as HTML in the codebase,
 * and a WYSIWYG that rewrites the markup would make the seeded articles and
 * the edited ones two different kinds of thing. The preview below is what
 * keeps that honest.
 *
 * Screenshots upload one at a time and attach immediately — an article has to
 * exist before a picture can belong to it, so a new article is saved first and
 * the picture button appears after.
 */
export function ArticleEditor({
  article,
  categories,
  onClose,
  onSaved,
}: {
  article: SupportArticle | null;
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const token = useAuthStore((s) => s.token);
  const file = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(article?.title ?? '');
  const [summary, setSummary] = useState(article?.summary ?? '');
  const [category, setCategory] = useState(article?.category ?? categories[0] ?? 'Getting started');
  const [body, setBody] = useState(article?.body ?? '');
  const [state, setState] = useState<'DRAFT' | 'PUBLISHED'>(article?.state ?? 'PUBLISHED');
  const [images, setImages] = useState(article?.images ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (!token) return;
    if (!title.trim() || !body.trim()) {
      setError('An article needs a title and something in it.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (article) {
        await api.support.update(article.id, { title, summary, category, body, state }, token);
      } else {
        await api.support.create({ title, summary, category, body }, token);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  async function addScreenshot(chosen: File) {
    if (!token || !article) return;
    setBusy(true);
    setError('');
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read that file.'));
        reader.readAsDataURL(chosen);
      });

      const image = await api.support.addImage(
        article.id,
        { data, mimeType: chosen.type, caption: '' },
        token,
      );
      setImages((all) => [...all, image]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That image did not upload.');
    } finally {
      setBusy(false);
    }
  }

  async function dropScreenshot(imageId: string) {
    if (!token || !article) return;
    await api.support.removeImage(article.id, imageId, token).catch(() => {});
    setImages((all) => all.filter((i) => i.id !== imageId));
  }

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-gray-900">
          {article ? `Editing “${article.title}”` : 'New article'}
        </h2>
        <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-900">
          Cancel
        </button>
      </div>

      <label className="block">
        <span className="text-sm font-medium">Title</span>
        <input className="input mt-1 w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      <label className="block">
        <span className="text-sm font-medium">Summary</span>
        <input
          className="input mt-1 w-full"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="One line, shown in the list and matched first by search."
        />
      </label>

      <div className="flex flex-wrap gap-4">
        <label className="block">
          <span className="text-sm font-medium">Category</span>
          <input
            className="input mt-1 w-56"
            list="support-categories"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          {/* A list rather than a select: typing a new one is how a category
              gets added, and there is no screen for managing them. */}
          <datalist id="support-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Visible to</span>
          <select
            className="input mt-1 w-56"
            value={state}
            onChange={(e) => setState(e.target.value as 'DRAFT' | 'PUBLISHED')}
          >
            <option value="PUBLISHED">Every organiser</option>
            <option value="DRAFT">Only platform admins</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium">Body</span>
        <textarea
          className="input mt-1 w-full font-mono text-xs"
          rows={16}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="<p>HTML. Headings as &lt;h3&gt;, emphasis as &lt;strong&gt;.</p>"
        />
      </label>

      {article && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium">Screenshots</span>
            <button
              type="button"
              onClick={() => file.current?.click()}
              disabled={busy}
              className="btn-secondary inline-flex items-center gap-1.5 text-sm"
            >
              <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
              Add a screenshot
            </button>
            <input
              ref={file}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const chosen = e.target.files?.[0];
                if (chosen) addScreenshot(chosen);
                e.target.value = '';
              }}
            />
          </div>

          {images.length > 0 && (
            <ul className="mt-3 grid gap-3 sm:grid-cols-3">
              {images.map((image) => (
                <li key={image.id} className="relative">
                  {image.url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={image.url}
                      alt={image.caption ?? ''}
                      className="w-full rounded-lg border border-gray-200"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => dropScreenshot(image.id)}
                    aria-label="Remove this screenshot"
                    className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 text-gray-600 shadow hover:text-[var(--danger)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!article && (
        <p className="text-xs text-gray-500">
          Save it first, then screenshots can be attached — a picture has to belong to something.
        </p>
      )}

      {body.trim() && (
        <div>
          <p className="text-sm font-medium">Preview</p>
          <div
            className="prose prose-sm mt-2 max-w-none rounded-lg border border-gray-200 bg-white p-4 text-gray-700"
            dangerouslySetInnerHTML={{ __html: body }}
          />
        </div>
      )}

      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

      <button type="button" onClick={save} disabled={busy} className="btn-primary text-sm">
        {busy ? 'Saving…' : article ? 'Save changes' : 'Create article'}
      </button>
    </section>
  );
}
