'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bold, Italic, Strikethrough, Underline, Quote, Link2, Smile, ImagePlus, Paperclip, X } from 'lucide-react';
import { sanitizeWikiHtml } from '@/lib/wiki-html';
import { isBlankBody } from '@/lib/rich-text';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, formatBytes, isImage } from '@/lib/attachments';

/**
 * The one box members type into.
 *
 * Charley, 2026-08-19: anywhere a member can write something, the same tools
 * should be there — including selecting text to format it. Before this, every
 * composer in the product was a bare `textarea` and every body was plain text,
 * so the same message looked different depending which screen wrote it.
 *
 * Built on `contentEditable` and `document.execCommand`. That API is
 * deprecated and still the only one every current browser implements without a
 * dependency; adding ProseMirror or Lexical is a real decision about bundle
 * size and lock-in, not something to slip into a composer change. Its output
 * is famously untidy — browsers emit `<font>` and inline styles — which
 * matters less than it sounds, because everything written here is sanitised
 * against the same allowlist the wiki uses, on the way out *and* on the way
 * in. The mess is stripped; the meaning survives.
 */

const EMOJI = ['👍', '🎉', '❤️', '😂', '🙏', '👀', '🔥', '✅', '🤔', '😅', '💡', '🌱'];

export function RichComposer({
  value,
  onChange,
  onSubmit,
  placeholder = 'Write a message...',
  submitLabel = 'Post',
  busy = false,
  rows = 3,
  files,
  onFilesChange,
}: {
  value: string;
  onChange: (html: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  submitLabel?: string;
  busy?: boolean;
  rows?: number;
  /**
   * Files chosen but not yet uploaded.
   *
   * Held here and uploaded by the caller *after* the post or comment exists,
   * because an attachment needs its parent's id and neither has one until it
   * is created. Omitting these two props turns attaching off, which is right
   * for a composer with nothing to hang a file on.
   */
  files?: File[];
  onFilesChange?: (files: File[]) => void;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const [toolbar, setToolbar] = useState<{ top: number; left: number } | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [fileError, setFileError] = useState('');
  const filePicker = useRef<HTMLInputElement>(null);
  const canAttach = Boolean(onFilesChange);

  function addFiles(chosen: FileList | null) {
    if (!chosen || !onFilesChange) return;
    const picked = Array.from(chosen);

    // Rejected here rather than at the far end of an upload, so somebody
    // choosing a 60 MB video is told immediately.
    const tooBig = picked.find((f) => f.size > ATTACHMENT_MAX_BYTES);
    if (tooBig) {
      setFileError(`${tooBig.name} is larger than 25 MB.`);
      return;
    }

    setFileError('');
    onFilesChange([...(files ?? []), ...picked]);
  }

  // Written to the DOM only when it disagrees. Assigning innerHTML on every
  // render would move the caret to the start on every keystroke.
  useEffect(() => {
    const el = editor.current;
    if (el && el.innerHTML !== value) el.innerHTML = value;
  }, [value]);

  const publish = useCallback(() => {
    if (editor.current) onChange(editor.current.innerHTML);
  }, [onChange]);

  /**
   * Show the formatting bubble while text is selected inside this editor.
   *
   * Scoped to this instance: several composers can be on one page — a post and
   * every comment under it — and a selection in one must not raise a toolbar
   * over another.
   */
  const syncToolbar = useCallback(() => {
    const selection = window.getSelection();
    const el = editor.current;
    if (!selection || selection.isCollapsed || !el || !selection.rangeCount) {
      setToolbar(null);
      return;
    }
    if (!el.contains(selection.anchorNode)) {
      setToolbar(null);
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const box = el.getBoundingClientRect();
    setToolbar({ top: rect.top - box.top - 44, left: Math.max(0, rect.left - box.left) });
  }, []);

  useEffect(() => {
    document.addEventListener('selectionchange', syncToolbar);
    return () => document.removeEventListener('selectionchange', syncToolbar);
  }, [syncToolbar]);

  function format(command: string, argument?: string) {
    editor.current?.focus();
    document.execCommand(command, false, argument);
    publish();
  }

  function addLink() {
    const href = window.prompt('Link to where?');
    if (!href) return;
    // Same rule as a member's profile links: an anchor a member writes is
    // clicked by everyone else, so javascript: and relative addresses are not
    // accepted. The sanitiser would strip them anyway; refusing here says why.
    if (!/^https?:\/\/\S+$/i.test(href.trim())) {
      window.alert('Links need to start with http:// or https://');
      return;
    }
    format('createLink', href.trim());
  }

  const tools = [
    { icon: Bold, label: 'Bold', run: () => format('bold') },
    { icon: Italic, label: 'Italic', run: () => format('italic') },
    { icon: Strikethrough, label: 'Strikethrough', run: () => format('strikeThrough') },
    { icon: Underline, label: 'Underline', run: () => format('underline') },
    { icon: Quote, label: 'Quote', run: () => format('formatBlock', 'blockquote') },
    { icon: Link2, label: 'Link', run: addLink },
  ];

  return (
    <div className="relative rounded-xl border border-gray-200 bg-white focus-within:border-brand-400">
      {toolbar && (
        <div
          className="absolute z-20 flex items-center gap-0.5 rounded-full bg-ink px-1.5 py-1 shadow-lg"
          style={{ top: toolbar.top, left: toolbar.left }}
          // Keeps the selection alive: a mousedown elsewhere would collapse it
          // before the command runs, so the button would format nothing.
          onMouseDown={(e) => e.preventDefault()}
        >
          {tools.map(({ icon: Icon, label, run }) => (
            <button
              key={label}
              type="button"
              onClick={run}
              title={label}
              aria-label={label}
              className="rounded-full p-1.5 text-paper-deep transition-colors hover:bg-white/15 hover:text-paper"
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      )}

      <div
        ref={editor}
        contentEditable={!busy}
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        data-placeholder={placeholder}
        onInput={publish}
        onBlur={publish}
        onPaste={(e) => {
          // Paste as text. Pasting from a word processor otherwise carries in
          // fonts, colours and background shading that the sanitiser strips
          // unevenly, so what lands rarely looks like what was copied.
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
                document.execCommand('insertText', false, text);
          publish();
        }}
        className="min-h-[var(--composer-min)] w-full px-3 py-2 text-sm text-gray-900 outline-none empty:before:text-gray-400 empty:before:content-[attr(data-placeholder)]"
        style={{ ['--composer-min' as string]: `${rows * 1.5}rem` }}
        suppressContentEditableWarning
      />

      {(files?.length ?? 0) > 0 && (
        <ul className="flex flex-wrap gap-2 border-t border-gray-100 px-2 py-2">
          {files!.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center gap-1.5 rounded-full bg-gray-100 py-1 pl-2.5 pr-1 text-xs text-gray-700"
            >
              {isImage(file.type) ? <ImagePlus className="h-3 w-3" /> : <Paperclip className="h-3 w-3" />}
              <span className="max-w-[12rem] truncate">{file.name}</span>
              <span className="text-gray-400">{formatBytes(file.size)}</span>
              <button
                type="button"
                onClick={() => onFilesChange?.(files!.filter((_, i) => i !== index))}
                className="rounded-full p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                aria-label={`Remove ${file.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {fileError && (
        <p className="border-t border-gray-100 px-3 py-1.5 text-xs text-red-600" role="alert">
          {fileError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-2 py-1.5">
        <div className="relative flex items-center gap-1">
          <button
            type="button"
            onClick={() => setEmojiOpen(!emojiOpen)}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Emoji"
            title="Emoji"
          >
            <Smile className="h-4 w-4" />
          </button>

          {emojiOpen && (
            <div className="absolute bottom-9 left-0 z-20 grid w-56 grid-cols-6 gap-1 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
              {EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    format('insertText', emoji);
                    setEmojiOpen(false);
                  }}
                  className="rounded p-1 text-lg hover:bg-gray-100"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

          {canAttach && (
            <>
              <input
                ref={filePicker}
                type="file"
                multiple
                accept={ATTACHMENT_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  // Cleared so choosing the same file twice still fires.
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => filePicker.current?.click()}
                className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Add an image"
                title="Image or GIF"
              >
                <ImagePlus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => filePicker.current?.click()}
                className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Attach a file"
                title="Attach a file"
              >
                <Paperclip className="h-4 w-4" />
              </button>
            </>
          )}

        {onSubmit && (
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy || (isBlankBody(value) && (files?.length ?? 0) === 0)}
            className="btn-primary text-xs disabled:opacity-40"
          >
            {busy ? 'Sending...' : submitLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/** What the composer produced, ready for the API. */
export function composerValue(html: string): string {
  return sanitizeWikiHtml(html).trim();
}
