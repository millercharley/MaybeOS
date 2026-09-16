import { randomInt } from 'crypto';
import { DOOR_WORDS } from './door-words';

/**
 * The five letters a member types at the door (DOR-01).
 *
 * **A real word** (Charley, 2026-09-16), because a code a member cannot
 * remember is a code they write on their phone or ask an organiser for at the
 * door. A word also survives being read aloud, where a random string does not.
 *
 * Charley's original rule still holds inside the words: five capital letters,
 * no I and no L. Both are there for the keypad and the phone screen rather
 * than the alphabet — I against 1 and l, L against 1.
 *
 * **This is not a secret to be guessed at leisure**, and the word list makes
 * that plainer than 7,962,624 random codes did: a few hundred words is nothing
 * to a machine. What keeps the door shut is that the code is checked against
 * one email address and the door rate-limits attempts — five tries, then
 * fifteen minutes (`integrations/door-sheet/Code.gs`).
 */
export const PIN_ALPHABET = 'ABCDEFGHJKMNOPQRSTUVWXYZ';
export const PIN_LENGTH = 5;

/** How many words a code can be. Worth stating: it is the ceiling on one co-op. */
export const WORD_SPACE = DOOR_WORDS.length;

/** How many codes the letters alone allow, for the fallback below. */
export const PIN_SPACE = PIN_ALPHABET.length ** PIN_LENGTH;

/**
 * A new code: a word this co-op is not already using.
 *
 * `crypto.randomInt`, not `Math.random`: this opens a building. `Math.random`
 * is seeded predictably enough that a sequence of codes issued in one batch
 * could be reconstructed from a couple of known ones, and it is the kind of
 * shortcut that is invisible until somebody looks for it.
 *
 * **Chosen from the words still free rather than retried until one is**, so
 * issuing the last few codes in a large co-op costs one draw, not dozens. The
 * unique index on `(orgId, doorPin)` is still what decides, because two passes
 * can draw at the same moment.
 *
 * **When a co-op has more members than there are words**, the code falls back
 * to random letters. Every member keeps getting a code that works — a locked
 * out member is worse than an unmemorable code — and the door script accepts
 * both, since the words are built from the same letters.
 *
 * The generator is injectable so the tests can prove the mapping rather than
 * the randomness — a test that rolls real dice and hopes is not a test.
 */
export function generateDoorPin(
  taken: ReadonlySet<string> = new Set(),
  nextInt: (max: number) => number = randomInt,
): string {
  const free = DOOR_WORDS.filter((word) => !taken.has(word));
  if (free.length > 0) return free[nextInt(free.length)];

  let pin = '';
  for (let i = 0; i < PIN_LENGTH; i += 1) {
    pin += PIN_ALPHABET[nextInt(PIN_ALPHABET.length)];
  }
  return pin;
}

/** Whether a string is one of ours — used before trusting anything typed in. */
export function isDoorPin(value: string): boolean {
  return new RegExp(`^[${PIN_ALPHABET}]{${PIN_LENGTH}}$`).test(value);
}

/** Whether a code is one of the words, rather than the letters fallback. */
export function isDoorWord(value: string): boolean {
  return DOOR_WORDS.includes(value);
}
