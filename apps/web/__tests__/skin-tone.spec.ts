import { readFileSync } from 'fs';
import { join } from 'path';
import { SKIN_TONES, applyTone, stripTone, toneOf } from '@/lib/skin-tone';
import { EMOJI_LIBRARY, searchEmoji, takesTone } from '@/lib/emoji-library';
import { looksLikeEmoji } from '@/lib/reactions';

/**
 * Giving a thumbs up in your own skin (CMN-24).
 *
 * Charley: "I don't like that people of color have to give a white person's
 * thumbs up." The bare 👍 is Unicode's tone-neutral form rather than a white
 * one, but there was no way to choose at all — so anybody who wanted to be
 * represented could not be.
 */
describe('putting a tone on an emoji', () => {
  it('adds the modifier', () => {
    expect(applyTone('👍', 'dark')).toBe('👍\u{1F3FF}');
    expect(applyTone('👍', 'medium')).toBe('👍\u{1F3FD}');
  });

  it('offers the five Fitzpatrick tones and the neutral form', () => {
    expect(SKIN_TONES).toHaveLength(6);
    expect(SKIN_TONES[0].modifier).toBe('');
  });

  it('drops the variation selector, which a modifier replaces', () => {
    /*
      ✌️ is U+270C U+FE0F. U+270C U+FE0F U+1F3FD is not a thing — the modifier
      already implies the emoji presentation, and leaving the selector in
      renders a floating square beside the glyph on some platforms.
    */
    const toned = applyTone('✌️', 'medium-dark');
    expect(toned).toBe('✌\u{1F3FE}');
    expect(toned).not.toContain('️');
  });

  it('re-tones rather than stacking', () => {
    // Changing your mind must not leave two modifiers on one emoji.
    const once = applyTone('👍', 'light');
    expect(applyTone(once, 'dark')).toBe('👍\u{1F3FF}');
  });

  it('goes back to neutral', () => {
    expect(applyTone('👍\u{1F3FF}', 'default')).toBe('👍');
    expect(stripTone('👍\u{1F3FD}')).toBe('👍');
  });

  it('reads the tone back off an emoji', () => {
    expect(toneOf('👍\u{1F3FC}')).toBe('medium-light');
    expect(toneOf('👍')).toBe('default');
  });

  it('produces something the API will still accept', () => {
    // The endpoint has taken 👍🏽 since CMN-21; this proves the two agree.
    for (const tone of SKIN_TONES) {
      expect(looksLikeEmoji(applyTone('👍', tone.id))).toBe(true);
    }
  });
});

describe('which emoji take a tone', () => {
  it('marks hands and people', () => {
    expect(takesTone('👍')).toBe(true);
    expect(takesTone('🙏')).toBe(true);
    expect(takesTone('🧑')).toBe(true);
  });

  it('does not mark things with no skin in them', () => {
    // A toned party popper is not a thing, and offering one would render a
    // popper followed by a stray colour swatch.
    expect(takesTone('🎉')).toBe(false);
    expect(takesTone('❤️')).toBe(false);
    expect(takesTone('🔥')).toBe(false);
  });

  it('marks nothing that a trailing modifier would break', () => {
    /*
      Only single-codepoint forms are marked. A joined sequence like 🧑‍🍳
      needs the modifier inserted *inside* the sequence, and appending it
      produces a chef followed by a floating hand.
    */
    const marked = EMOJI_LIBRARY.flatMap((g) => g.emoji).filter((e) => e.tone);
    for (const entry of marked) {
      expect(entry.emoji).not.toContain('‍'); // zero-width joiner
    }
  });

  it('leaves an unknown emoji alone', () => {
    expect(takesTone('🫎')).toBe(false);
  });
});

describe('searching the library', () => {
  it('finds by name', () => {
    expect(searchEmoji('thumbs').map((e) => e.emoji)).toContain('👍');
  });

  it('finds by what somebody would actually type', () => {
    expect(searchEmoji('yes').map((e) => e.emoji)).toContain('👍');
    expect(searchEmoji('lol').map((e) => e.emoji)).toContain('😂');
    expect(searchEmoji('congrats').map((e) => e.emoji)).toContain('🎉');
  });

  it('narrows on every word rather than widening', () => {
    // "green heart" means the green one, not everything green plus every heart.
    const found = searchEmoji('green heart').map((e) => e.emoji);
    expect(found).toEqual(['💚']);
  });

  it('answers nothing for nothing', () => {
    expect(searchEmoji('   ')).toEqual([]);
  });

  it('holds no duplicates, which would react twice from one grid', () => {
    const all = EMOJI_LIBRARY.flatMap((g) => g.emoji).map((e) => e.emoji);
    expect(new Set(all).size).toBe(all.length);
  });

  it('is all genuinely emoji, by the rule the API applies', () => {
    for (const entry of EMOJI_LIBRARY.flatMap((g) => g.emoji)) {
      expect(looksLikeEmoji(entry.emoji)).toBe(true);
    }
  });
});

describe('the picker', () => {
  const src = readFileSync(
    join(__dirname, '..', 'components', 'reactions', 'emoji-library-picker.tsx'),
    'utf8',
  );

  it('remembers the tone instead of asking every time', () => {
    // Asking somebody to pick their own skin each time they agree with
    // something would be its own kind of insult.
    expect(src).toMatch(/rememberTone\(tone\)/);
    expect(src).toMatch(/useEffect\(\(\) => setTone\(readTone\(\)\), \[\]\)/);
  });

  it('shows the tone chooser at the top, not buried', () => {
    expect(src).toMatch(/Skin tone/);
    expect(src.indexOf('Skin tone')).toBeLessThan(src.indexOf('EMOJI_LIBRARY.map'));
  });

  it('applies the tone to the whole grid, before anything is chosen', () => {
    expect(src).toMatch(/takesTone\(entry\.emoji\) \? applyTone\(entry\.emoji, tone\) : entry\.emoji/);
  });

  it('keeps a way in for anything the library does not hold', () => {
    expect(src).toMatch(/Any emoji…/);
  });
});
