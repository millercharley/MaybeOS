/**
 * Minimal escaping for text that is about to become markup.
 *
 * A third copy of this was about to be written — the Commons has one for
 * channel invitations (CMN-11) and the web app has one in `rich-text` — so it
 * lives here now. Anywhere the server builds HTML out of something a member
 * typed, their words have to arrive as words: a co-op that names an event
 * `<img src=x onerror=...>` must not have that run in everybody else's
 * Commons.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
