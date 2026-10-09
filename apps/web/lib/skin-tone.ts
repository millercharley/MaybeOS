/**
 * Choosing the colour of your own hands (CMN-24).
 *
 * Charley: "I don't like that people of color have to give a white person's
 * thumbs up."
 *
 * The bare 👍 is Unicode's tone-neutral form and renders yellow rather than
 * white, but that is beside the point he is making: there was no way to
 * choose at all, so anybody who wanted to be represented could not be. The
 * reaction *endpoint* has accepted 👍🏽 since CMN-21 — nothing but the picker
 * was in the way.
 */

/** The five Fitzpatrick modifiers, and the neutral form that uses none. */
export const SKIN_TONES = [
  { id: 'default', modifier: '', label: 'Default' },
  { id: 'light', modifier: '\u{1F3FB}', label: 'Light' },
  { id: 'medium-light', modifier: '\u{1F3FC}', label: 'Medium light' },
  { id: 'medium', modifier: '\u{1F3FD}', label: 'Medium' },
  { id: 'medium-dark', modifier: '\u{1F3FE}', label: 'Medium dark' },
  { id: 'dark', modifier: '\u{1F3FF}', label: 'Dark' },
] as const;

export type SkinToneId = (typeof SKIN_TONES)[number]['id'];

const MODIFIERS = SKIN_TONES.map((t) => t.modifier).filter(Boolean);

/** U+FE0F, which asks for the colourful form and is dropped when a tone is set. */
const VARIATION_SELECTOR = '️';

/**
 * Put a tone on an emoji that takes one.
 *
 * The variation selector comes off first. ✌️ is U+270C U+FE0F, and
 * U+270C U+FE0F U+1F3FD is not a thing — the modifier already implies the
 * emoji presentation, so leaving it in produces a glyph followed by a
 * floating square on some platforms.
 */
export function applyTone(base: string, tone: SkinToneId): string {
  const modifier = SKIN_TONES.find((t) => t.id === tone)?.modifier ?? '';
  const bare = stripTone(base);
  if (!modifier) return bare;

  return bare.replace(VARIATION_SELECTOR, '') + modifier;
}

/** The emoji without any tone on it, for comparing and for re-toning. */
export function stripTone(emoji: string): string {
  let out = emoji;
  for (const modifier of MODIFIERS) out = out.split(modifier).join('');
  return out;
}

/** Is a tone already on this one? */
export function toneOf(emoji: string): SkinToneId {
  const found = SKIN_TONES.find((t) => t.modifier && emoji.includes(t.modifier));
  return found?.id ?? 'default';
}

/**
 * Where somebody's choice is kept.
 *
 * On the device rather than the account, deliberately. It is a rendering
 * preference for one person on one machine, it is wanted instantly and
 * offline, and putting it on the server would mean a migration, a payload and
 * a write on every change — for something that is nobody else's business.
 */
const STORED = 'maybeos.skin-tone';

export function readTone(): SkinToneId {
  if (typeof window === 'undefined') return 'default';
  try {
    const saved = window.localStorage.getItem(STORED);
    return SKIN_TONES.some((t) => t.id === saved) ? (saved as SkinToneId) : 'default';
  } catch {
    // Private windows and blocked storage both throw. A reaction bar is not
    // worth a crash.
    return 'default';
  }
}

export function rememberTone(tone: SkinToneId): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORED, tone);
  } catch {
    /* Chosen for this visit only, which is better than refusing to change. */
  }
}
