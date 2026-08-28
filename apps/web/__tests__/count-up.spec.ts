import {
  ROLL_MS,
  decimalsOf,
  deltaLabel,
  easeOutCubic,
  frameValue,
  shouldAnimate,
} from '@/lib/count-up';

describe('the number that rolls', () => {
  describe('easing', () => {
    it('starts at the start and ends at the end', () => {
      expect(easeOutCubic(0)).toBe(0);
      expect(easeOutCubic(1)).toBe(1);
    });

    it('is more than half done at the half-way point', () => {
      // Ease-out, so the number is legible for most of the animation and only
      // the first moment is a blur. A linear count reads as a spinner made of
      // digits.
      expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    });
  });

  describe('each frame is a real value', () => {
    it('never shows a fraction of a person', () => {
      // A count of people is a count of people at every frame, not only at
      // the end.
      for (const p of [0.1, 0.25, 0.5, 0.75, 0.9]) {
        expect(Number.isInteger(frameValue(0, 464, p, 0))).toBe(true);
      }
    });

    it('lands exactly on the target', () => {
      expect(frameValue(0, 464, 1, 0)).toBe(464);
    });

    it('counts down as well as up', () => {
      expect(frameValue(100, 40, 1, 0)).toBe(40);
      expect(frameValue(100, 40, 0.5, 0)).toBeLessThan(100);
    });

    it('clamps a progress value outside the run', () => {
      expect(frameValue(0, 10, -1, 0)).toBe(0);
      expect(frameValue(0, 10, 2, 0)).toBe(10);
    });

    it('keeps the decimals the data has, and invents none', () => {
      expect(decimalsOf(464)).toBe(0);
      expect(decimalsOf(12.5)).toBe(1);
      expect(frameValue(0, 12.5, 1, 1)).toBe(12.5);
    });
  });

  describe('when not to animate', () => {
    it('respects a request for less motion', () => {
      // Somebody has told their system they do not want this. That outranks
      // the delight.
      expect(shouldAnimate(100, 464, true)).toBe(false);
    });

    it('does nothing when the number has not changed', () => {
      expect(shouldAnimate(464, 464, false)).toBe(false);
    });

    it('rolls on first arrival, which is the number landing', () => {
      expect(shouldAnimate(null, 464, false)).toBe(true);
    });

    it('refuses a value that is not a number', () => {
      expect(shouldAnimate(0, NaN, false)).toBe(false);
    });
  });

  describe('the delta chip says what it can defend', () => {
    it('says joined, not a bare plus', () => {
      // MaybeOS does not record departures — removing a membership deletes
      // the row — so a *net* figure is not something this can honestly
      // compute. "+2" beside a total invites a subtraction nobody checked.
      expect(deltaLabel(2)).toBe('+2 joined this month');
    });

    it('says nothing when nobody joined', () => {
      expect(deltaLabel(0)).toBeNull();
    });

    it('never shows a negative, because it cannot mean one', () => {
      expect(deltaLabel(-3)).toBeNull();
    });
  });

  it('runs for about the six hundred milliseconds asked for', () => {
    expect(ROLL_MS).toBe(600);
  });
});
