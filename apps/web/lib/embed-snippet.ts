/**
 * The snippet an organiser copies onto their own website (EVT-21).
 *
 * Separate from the component because the thing that can go wrong is a
 * *string* — a half-typed colour pasted into somebody's site, or an accent in
 * the preview that is not in the code they copied — and a string is worth
 * testing directly rather than through a rendered card.
 */
export const DEFAULT_ACCENT = '#b03030';

/** `#abc` or `#aabbcc`, with or without the hash. Null if it is not a colour. */
export function normaliseHex(input: string): string | null {
  const value = input.trim().replace(/^#/, '');
  if (!/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) return null;
  return `#${value.toLowerCase()}`;
}

/**
 * One script tag.
 *
 * The accent is included only once it is a real colour and differs from the
 * default: a co-op that never touched it should not be handed an attribute to
 * wonder about, and "#b0" must never reach somebody's website.
 */
export function embedSnippet(origin: string, slug: string, accentInput: string): string {
  const accent = normaliseHex(accentInput);
  return (
    `<script src="${origin}/embed.js" data-org="${slug}"` +
    (accent && accent !== DEFAULT_ACCENT ? ` data-accent="${accent}"` : '') +
    ` defer></script>`
  );
}
