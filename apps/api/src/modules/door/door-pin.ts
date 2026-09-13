import { randomInt } from 'crypto';

/**
 * The five letters a member types at the door (DOR-01).
 *
 * Charley's rule: five capital letters, no I and no L. Both are there for the
 * keypad and the phone screen rather than the alphabet — I against 1 and l,
 * L against 1 — and a code somebody reads back wrong is a member standing
 * outside a locked building.
 *
 * Twenty-four letters, five long, is 7,962,624 codes. That is comfortable for
 * a co-op of a few hundred and it is *not* a secret worth guessing at leisure:
 * whatever reads these at the door has to rate-limit attempts, because eight
 * million is nothing to a machine and everything to a person.
 */
export const PIN_ALPHABET = 'ABCDEFGHJKMNOPQRSTUVWXYZ';
export const PIN_LENGTH = 5;

/** How many codes exist at all. Used by the tests and worth stating. */
export const PIN_SPACE = PIN_ALPHABET.length ** PIN_LENGTH;

/**
 * A new code.
 *
 * `crypto.randomInt`, not `Math.random`: this opens a building. `Math.random`
 * is seeded predictably enough that a sequence of codes issued in one batch
 * could be reconstructed from a couple of known ones, and it is the kind of
 * shortcut that is invisible until somebody looks for it. `randomInt` is also
 * rejection-sampled, so no letter is very slightly likelier than another.
 *
 * The generator is injectable so the tests can prove the mapping rather than
 * the randomness — a test that rolls real dice and hopes is not a test.
 */
export function generateDoorPin(nextInt: (max: number) => number = randomInt): string {
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
