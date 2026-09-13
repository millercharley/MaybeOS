import { generateDoorPin, isDoorPin, PIN_ALPHABET, PIN_LENGTH, PIN_SPACE } from '../door-pin';

/**
 * Door codes (DOR-01).
 *
 * Five capital letters, no I and no L — both excluded for the keypad rather
 * than the alphabet, because a code read back wrong is a member standing
 * outside a locked building.
 */
describe('a door code', () => {
  it('is five letters from the alphabet Charley asked for', () => {
    for (let i = 0; i < 200; i += 1) {
      const pin = generateDoorPin();
      expect(pin).toHaveLength(PIN_LENGTH);
      expect(pin).toMatch(/^[A-Z]{5}$/);
    }
  });

  it('never contains I or L, whatever it rolls', () => {
    // The whole point of the restriction. Checked across enough codes that a
    // single unlucky draw cannot pass it.
    const many = Array.from({ length: 2000 }, () => generateDoorPin()).join('');
    expect(many).not.toMatch(/[IL]/);
  });

  it('can reach every letter of the alphabet it is given', () => {
    // A generator that silently used 24 letters but could only produce 23 —
    // an off-by-one on the range — would pass every other test here.
    const seen = new Set<string>();
    for (let i = 0; i < 5000 && seen.size < PIN_ALPHABET.length; i += 1) {
      for (const letter of generateDoorPin()) seen.add(letter);
    }
    expect([...seen].sort().join('')).toBe(PIN_ALPHABET);
  });

  it('maps each draw to a letter, in order', () => {
    // The randomness is Node's problem. What is ours is the mapping, so it is
    // tested with the dice replaced.
    const draws = [0, 1, 2, PIN_ALPHABET.length - 1, 0];
    let i = 0;
    expect(generateDoorPin(() => draws[i++])).toBe('ABCZA');
  });

  it('asks for a number inside the alphabet, never its length as an index', () => {
    const asked: number[] = [];
    generateDoorPin((max) => {
      asked.push(max);
      return 0;
    });
    // `randomInt(max)` is exclusive of max, so this is the whole alphabet and
    // not one letter short of it.
    expect(asked).toEqual(Array(PIN_LENGTH).fill(PIN_ALPHABET.length));
  });

  it('is one of 7,962,624 — small enough that the door must rate-limit', () => {
    expect(PIN_SPACE).toBe(7962624);
  });

  describe('recognising one', () => {
    it('accepts what it generates', () => {
      expect(isDoorPin(generateDoorPin())).toBe(true);
    });

    it('refuses the excluded letters, lower case, and the wrong length', () => {
      expect(isDoorPin('ABCIL')).toBe(false);
      expect(isDoorPin('abcde')).toBe(false);
      expect(isDoorPin('ABCD')).toBe(false);
      expect(isDoorPin('ABCDEF')).toBe(false);
      expect(isDoorPin('')).toBe(false);
      expect(isDoorPin('ABC-E')).toBe(false);
    });
  });
});
