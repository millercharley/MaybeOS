/**
 * @jest-environment jsdom
 */
import { GIVE_UP_AFTER_MS, scrollToHashWhenReady } from '@/lib/scroll-to-hash';

/**
 * Landing on a card that has not loaded yet (UI-03).
 *
 * Every card on My Settings fetches before it renders, so the browser's own
 * jump to `#interests` finds nothing and gives up — and a member following a
 * link from a Radar digest arrives at their password form instead.
 */
describe('waiting for the card before scrolling to it', () => {
  let frames: Array<() => void>;
  let scrolled: string[];

  beforeEach(() => {
    frames = [];
    scrolled = [];
    document.body.innerHTML = '';
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(() => cb(0));
      return frames.length;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  /** Run the queued frames, the way a browser would. */
  const tick = (times = 1) => {
    for (let i = 0; i < times; i += 1) {
      const next = frames.shift();
      if (next) next();
    }
  };

  function addCard(id: string) {
    const el = document.createElement('section');
    el.id = id;
    el.scrollIntoView = () => scrolled.push(id);
    document.body.appendChild(el);
  }

  it('scrolls as soon as the card is there', () => {
    addCard('interests');
    scrollToHashWhenReady('#interests');
    tick();

    expect(scrolled).toEqual(['interests']);
  });

  it('keeps looking while the card is still loading', () => {
    scrollToHashWhenReady('#interests');
    tick(3);
    expect(scrolled).toEqual([]);

    // The fetch lands, and the next frame finds it.
    addCard('interests');
    tick();
    expect(scrolled).toEqual(['interests']);
  });

  /**
   * A hash that never matches is a link to a card this co-op does not have —
   * Radar is on a plan, the Buddy System is a setting. The honest outcome is
   * the top of the page, not a loop.
   */
  it('gives up rather than looking forever', () => {
    let now = 0;
    scrollToHashWhenReady('#interests', () => now);

    tick();
    expect(frames.length).toBe(1); // still looking

    now = GIVE_UP_AFTER_MS + 1;
    tick();

    // The measure is whether it queued another look, not whether it scrolled:
    // a version that never gives up also never scrolls here, so counting
    // scrolls would pass against it.
    expect(frames).toEqual([]);
    expect(scrolled).toEqual([]);
  });

  it('does nothing without a hash', () => {
    addCard('interests');
    scrollToHashWhenReady('');
    tick(3);

    expect(scrolled).toEqual([]);
  });

  /** A member who navigates away must not be yanked back by a late fetch. */
  it('stops when the caller cancels', () => {
    const cancel = scrollToHashWhenReady('#interests');
    cancel();
    addCard('interests');
    tick(3);

    expect(scrolled).toEqual([]);
  });
});
