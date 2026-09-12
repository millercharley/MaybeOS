'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bold, Italic, Strikethrough, Underline, Quote, Link2, Smile, ImagePlus, Paperclip, X,
  AtSign, Hash,
} from 'lucide-react';
import { sanitizeWikiHtml } from '@/lib/wiki-html';
import { isBlankBody, linkHtml } from '@/lib/rich-text';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, formatBytes, isImage } from '@/lib/attachments';
import { COMPOSER_EMOJI } from '@/lib/emoji';
import {
  MentionChannel,
  MentionPerson,
  channelLabel,
  findMentionQuery,
  matchMentions,
  mentionHtml,
} from '@/lib/mentions';

/** Who and what this composer can mention (CMN-11). */
export interface MentionSources {
  orgSlug: string;
  people: MentionPerson[];
  channels: MentionChannel[];
}

type Suggestion = { id: string; label: string; kind: 'member' | 'channel' };

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
  mentions,
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
  /**
   * The members and channels `@` and `#` offer (CMN-11).
   *
   * Omitting it turns mentions off, which is right for a composer with no org
   * around it — the picker would have nothing true to show.
   */
  mentions?: MentionSources;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const [toolbar, setToolbar] = useState<{ top: number; left: number } | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [fileError, setFileError] = useState('');
  const filePicker = useRef<HTMLInputElement>(null);
  const canAttach = Boolean(onFilesChange);

  // ─── Mentions (CMN-11) ──────────────────────────────────────
  //
  // `picker.length` is how much to delete when one is chosen: the trigger
  // character and whatever was typed after it. Kept with the open picker
  // rather than recomputed on selection, because by then the caret may have
  // moved and the two would disagree.
  const [picker, setPicker] = useState<{
    trigger: '@' | '#';
    items: Suggestion[];
    length: number;
    top: number;
    left: number;
  } | null>(null);
  const [active, setActive] = useState(0);
  const canMention = Boolean(mentions);

  /** The text from the start of the editor to the caret. */
  function textBeforeCaret(): string | null {
    const el = editor.current;
    const selection = window.getSelection();
    if (!el || !selection?.rangeCount) return null;
    const caret = selection.getRangeAt(0);
    if (!el.contains(caret.startContainer)) return null;

    const range = document.createRange();
    range.setStart(el, 0);
    range.setEnd(caret.startContainer, caret.startOffset);
    return range.toString();
  }

  /** Open, update or close the picker for whatever is being typed. */
  function syncPicker() {
    if (!mentions) return;

    const before = textBeforeCaret();
    const found = before === null ? null : findMentionQuery(before);
    if (!found) {
      setPicker(null);
      return;
    }

    const items: Suggestion[] =
      found.trigger === '@'
        ? matchMentions(mentions.people, found.query).map((person) => ({
            id: person.id,
            label: person.name,
            kind: 'member' as const,
          }))
        : matchMentions(mentions.channels, found.query).map((channel) => ({
            id: channel.id,
            label: channelLabel(channel),
            kind: 'channel' as const,
          }));

    // Nothing matches: close rather than hang an empty box under the caret.
    // Somebody typing an email address is not asking for a member picker.
    if (items.length === 0) {
      setPicker(null);
      return;
    }

    const selection = window.getSelection();
    const el = editor.current;
    if (!selection?.rangeCount || !el) return;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const box = el.getBoundingClientRect();

    setActive(0);
    setPicker({
      trigger: found.trigger,
      items,
      length: found.length,
      top: rect.bottom - box.top + 6,
      left: Math.max(0, rect.left - box.left),
    });
  }

  /** Swap the half-typed mention for a real link. */
  function choose(item: Suggestion) {
    const el = editor.current;
    const selection = window.getSelection();
    if (!el || !mentions || !selection?.rangeCount || !picker) return;

    el.focus();
    const range = selection.getRangeAt(0);
    const node = range.startContainer;

    // Delete the trigger and the query first. Only attempted inside a single
    // text node — which is where a just-typed "@ada" always is — because
    // walking backwards across element boundaries to delete characters is how
    // a composer eats the paragraph before it.
    if (node.nodeType === Node.TEXT_NODE && range.startOffset >= picker.length) {
      range.setStart(node, range.startOffset - picker.length);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    const label = item.kind === 'member' ? `@${item.label}` : item.label;
    // The trailing space is a normal space in its own text node, so the next
    // character typed is not swallowed into the anchor.
    document.execCommand(
      'insertHTML',
      false,
      `${mentionHtml(item.kind, mentions.orgSlug, item.id, label)}&nbsp;`,
    );

    setPicker(null);
    publish();
  }

  /** The `@` and `#` buttons: type the trigger, then let `syncPicker` run. */
  function startMention(trigger: '@' | '#') {
    editor.current?.focus();
    document.execCommand('insertText', false, trigger);
    publish();
    syncPicker();
  }

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

  /**
   * Turn the selected words into a link (CNT-02).
   *
   * The selection has to be saved before the prompt and put back after it.
   * `window.prompt` moves focus out of the editor and collapses the range, so
   * by the time `createLink` ran there was nothing selected to wrap — and a
   * collapsed `createLink` does not fail, it drops a stray anchor at the caret
   * with the URL as its own text. Reproduced in a browser: selecting
   * "maybeitsfate.circle.so" and linking it left the words untouched and put
   * `<a href="…">https://…</a>` at the very start of the article instead.
   *
   * The toolbar already knew about this class of bug one step earlier — it
   * calls `preventDefault` on mousedown so clicking a button does not collapse
   * the selection. The dialog is the same problem, unguarded.
   */
  function addLink() {
    const el = editor.current;
    if (!el) return;

    const selection = window.getSelection();
    const saved =
      selection && selection.rangeCount > 0 && el.contains(selection.anchorNode)
        ? selection.getRangeAt(0).cloneRange()
        : null;

    const href = window.prompt('Link to where?');
    if (!href) return;
    // Same rule as a member's profile links: an anchor a member writes is
    // clicked by everyone else, so javascript: and relative addresses are not
    // accepted. The sanitiser would strip them anyway; refusing here says why.
    if (!/^https?:\/\/\S+$/i.test(href.trim())) {
      window.alert('Links need to start with http:// or https://');
      return;
    }
    const url = href.trim();

    el.focus();
    if (saved) {
      const live = window.getSelection();
      live?.removeAllRanges();
      live?.addRange(saved);
    }

    if (!saved || saved.collapsed) {
      // Nothing was selected. `createLink` would do nothing at all here, so the
      // button would appear broken; every other editor inserts the address as
      // its own link instead. Escaped because the href is about to be markup —
      // the pattern above already refuses whitespace, but not a quote.
      document.execCommand('insertHTML', false, linkHtml(url));
    } else {
      document.execCommand('createLink', false, url);
    }
    publish();
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
        onInput={() => {
          publish();
          syncPicker();
        }}
        onBlur={() => {
          publish();
          // Late enough for a click on the picker to land first — closing on
          // blur alone means the list vanishes before the mouse arrives.
          window.setTimeout(() => setPicker(null), 150);
        }}
        onKeyDown={(e) => {
          if (!picker) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => (i + 1) % picker.items.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => (i - 1 + picker.items.length) % picker.items.length);
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            // Enter belongs to the picker while it is open, and to the
            // paragraph otherwise.
            e.preventDefault();
            choose(picker.items[active]);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setPicker(null);
          }
        }}
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

      {/* The mention picker, under the caret (CMN-11). `onMouseDown` is
          prevented so clicking an entry does not collapse the selection the
          insertion needs — the same guard the formatting bubble uses. */}
      {picker && (
        <ul
          className="absolute z-30 max-h-56 w-64 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
          style={{ top: picker.top, left: picker.left }}
          onMouseDown={(e) => e.preventDefault()}
          role="listbox"
          aria-label={picker.trigger === '@' ? 'Members' : 'Channels'}
        >
          {picker.items.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => choose(item)}
                onMouseEnter={() => setActive(index)}
                role="option"
                aria-selected={index === active}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                  index === active ? 'bg-brand-50 text-brand-700' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="truncate">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

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
        <div className="relative flex flex-wrap items-center gap-0.5">
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
              {COMPOSER_EMOJI.map((emoji) => (
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

          {canMention && (
            <>
              <button
                type="button"
                onClick={() => startMention('#')}
                className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Mention a channel"
                title="Mention a channel"
              >
                <Hash className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => startMention('@')}
                className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Mention someone"
                title="Mention someone"
              >
                <AtSign className="h-4 w-4" />
              </button>
            </>
          )}

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
                title="Image"
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
        </div>

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
