/**
 * The emoji MaybeOS offers (CMN-11).
 *
 * A short, chosen list rather than a full picker with search and skin tones:
 * a complete emoji keyboard is a dependency and a data file, and every
 * browser already has one behind the operating system's own shortcut. What
 * this needs to do is make the common cases one click.
 *
 * Anything can still be *typed* into the channel emoji box — the field
 * accepts any emoji the API accepts, including ones not listed here.
 */

/** Reactions and asides, in the message composer. */
export const COMPOSER_EMOJI = ['👍', '🎉', '❤️', '😂', '🙏', '👀', '🔥', '✅', '🤔', '😅', '💡', '🌱'];

/**
 * Channel markers, grouped the way a co-op's sidebar tends to read: talking,
 * making, the building, money and admin, the neighbourhood.
 */
export const CHANNEL_EMOJI = [
  '💬', '📣', '👋', '❓', '🗣️', '📌',
  '🎨', '🎭', '🎶', '📷', '✍️', '🧵',
  '🏙️', '🏠', '🔧', '🧹', '🪴', '🔑',
  '📚', '💼', '📅', '💰', '📊', '🗳️',
  '🚲', '🌱', '🍲', '☕', '🐝', '🎉',
];
