import { generateDoorPin, isDoorPin, isDoorWord, PIN_ALPHABET, PIN_LENGTH, WORD_SPACE } from '../door-pin';
import { DOOR_WORDS } from '../door-words';

/**
 * Door codes are real words (DOR-01, Charley 2026-09-16), so a member can
 * remember one and read it back correctly.
 */
describe('the door word list', () => {
  it('is five capital letters', () => {
    for (const word of DOOR_WORDS) {
      expect([word, /^[A-Z]{5}$/.test(word)]).toEqual([word, true]);
      expect(word).toBe(word.toUpperCase());
      expect(word).toHaveLength(PIN_LENGTH);
    }
  });

  it('holds no duplicates, so the words a co-op can hand out are what they look like', () => {
    expect(new Set(DOOR_WORDS).size).toBe(DOOR_WORDS.length);
  });

  it('is long enough for a community of several hundred', () => {
    expect(WORD_SPACE).toBeGreaterThanOrEqual(700);
  });

  it('uses I and L, which a serif capital settles (Charley, 2026-09-16)', () => {
    // The ordinary words that were unreachable while I and L were left out.
    for (const word of ['TABLE', 'LIGHT', 'RIVER', 'MUSIC']) expect(DOOR_WORDS).toContain(word);
  });

  it('holds nothing unkind, clinical or brand-shaped', () => {
    // The list was filtered by hand; this keeps an addition from slipping one in.
    const unwanted = ['DEATH', 'ABUSE', 'DRUGS', 'NAKED', 'TUMOR', 'FRAUD', 'THEFT', 'ANGRY', 'CRAZY', 'HONDA', 'KODAK', 'JESUS'];
    for (const word of unwanted) expect(DOOR_WORDS).not.toContain(word);
  });
});

describe('a door code', () => {
  it('is a word from the list', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(isDoorWord(generateDoorPin())).toBe(true);
    }
  });

  it('is never one the co-op is already using', () => {
    const taken = new Set(DOOR_WORDS.slice(0, DOOR_WORDS.length - 1));
    expect(generateDoorPin(taken)).toBe(DOOR_WORDS[DOOR_WORDS.length - 1]);
  });

  it('draws from the words still free, so the last codes cost one draw each', () => {
    const taken = new Set(DOOR_WORDS.slice(0, 3));
    const asked: number[] = [];
    const pin = generateDoorPin(taken, (max) => {
      asked.push(max);
      return 0;
    });
    expect(asked).toEqual([DOOR_WORDS.length - 3]);
    expect(pin).toBe(DOOR_WORDS[3]);
  });

  it('falls back to letters rather than leaving a member without a code', () => {
    // A co-op with more members than there are words. An unmemorable code
    // beats a member who cannot get in.
    const everyWord = new Set(DOOR_WORDS);
    const pin = generateDoorPin(everyWord);
    expect(isDoorWord(pin)).toBe(false);
    expect(isDoorPin(pin)).toBe(true);
  });

  it('asks for a number inside the alphabet when it falls back, never its length as an index', () => {
    const asked: number[] = [];
    generateDoorPin(new Set(DOOR_WORDS), (max) => {
      asked.push(max);
      return max - 1;
    });
    expect(asked).toEqual(Array(PIN_LENGTH).fill(PIN_ALPHABET.length));
  });

  it('accepts its own codes, and refuses anything else', () => {
    expect(isDoorPin(generateDoorPin())).toBe(true);
    expect(isDoorPin('ABCDEF')).toBe(false);
    expect(isDoorPin('ABCD')).toBe(false);
    expect(isDoorPin('ABC1E')).toBe(false); // a digit is not a letter
    expect(isDoorPin('abcde')).toBe(false); // codes are shown, and typed, in capitals
    expect(isDoorWord('ZZZZZ')).toBe(false);
  });
});
