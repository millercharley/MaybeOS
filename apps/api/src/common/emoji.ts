/**
 * What counts as an emoji, wherever MaybeOS accepts one (CMN-11, CMN-21).
 *
 * Moved out of the channel DTO when reactions stopped being a fixed list and
 * needed the same rule: a validator that two features depend on does not
 * belong inside one of them.
 *
 * The rule wants at least one pictograph or a flag, allows the joiners and
 * modifiers that make up a single glyph — skin tones, variation selectors,
 * the zero-width joiner in 👨‍👩‍👧‍👦 — and caps the length, because a "single
 * emoji" can legitimately be several code points and illegitimately be a
 * sentence. `[^\w\s]` is what refuses "General" typed into an emoji box, and
 * what stops a reaction being used to write words under somebody's post.
 */
export const EMOJI_PATTERN =
  /^(?=.*(\p{Extended_Pictographic}|\p{Regional_Indicator}))[^\w\s]{1,24}$/u;

/** Does this string hold exactly one emoji's worth of characters? */
export function isEmoji(value: string): boolean {
  return EMOJI_PATTERN.test(value);
}
