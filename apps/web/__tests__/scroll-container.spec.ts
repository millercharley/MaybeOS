/**
 * @jest-environment jsdom
 */
import { scrollParent, scrollToBottom } from '@/lib/scroll-container';

/**
 * Which element is actually scrolling (CMN-18).
 *
 * Reported as "on my phone the Commons opens on the oldest message and I have
 * to scroll down". Two separate faults underneath, both of which failed
 * silently: the Commons wrote `scrollTop` to a pane that only scrolls from
 * `lg` up — below it the pane grows to fit every post and the app shell's
 * `<main>` is what scrolls — and `scrollTop` written to an element that
 * cannot scroll is accepted, clamped to zero, and reported as success.
 *
 * The distinction these pin is between *could* scroll and *is* scrolling. An
 * unbounded `overflow-y: auto` flex child has the style and never scrolls.
 */
function build(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

/** jsdom computes no layout, so heights are declared the way a browser found them. */
function size(el: Element, clientHeight: number, scrollHeight: number) {
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
}

describe('finding the element that scrolls', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('returns an ancestor that both can scroll and has somewhere to go', () => {
    const outer = build('<div style="overflow-y: auto"><div id="inner"></div></div>');
    size(outer, 700, 4000);

    expect(scrollParent(document.getElementById('inner'))).toBe(outer);
  });

  /** The Commons pane below `lg`: the style is there, the overflow is not. */
  it('looks past a scrollable-looking element whose content fits', () => {
    const outer = build(
      '<div style="overflow-y: auto"><div id="pane" style="overflow-y: auto"></div></div>',
    );
    const pane = document.getElementById('pane')!;
    size(outer, 700, 4000);
    size(pane, 4000, 4000);

    expect(scrollParent(pane)).toBe(outer);
  });

  it('prefers the nearest scrolling ancestor over a further one', () => {
    const outer = build(
      '<div style="overflow-y: auto"><div id="mid" style="overflow-y: scroll"><div id="leaf"></div></div></div>',
    );
    const mid = document.getElementById('mid')!;
    size(outer, 700, 4000);
    size(mid, 300, 2000);

    expect(scrollParent(document.getElementById('leaf'))).toBe(mid);
  });

  it('accepts overflow-y: scroll as well as auto', () => {
    const outer = build('<div style="overflow-y: scroll"><div id="inner"></div></div>');
    size(outer, 700, 4000);

    expect(scrollParent(document.getElementById('inner'))).toBe(outer);
  });

  it.each(['hidden', 'visible', 'clip'])('ignores an ancestor with overflow-y: %s', (overflowY) => {
    const outer = build(`<div style="overflow-y: ${overflowY}"><div id="inner"></div></div>`);
    size(outer, 700, 4000);

    expect(scrollParent(document.getElementById('inner'))).not.toBe(outer);
  });

  it('falls back to the document when nothing between scrolls', () => {
    build('<div><div id="inner"></div></div>');

    // What the browser itself scrolls when nothing else will.
    expect(scrollParent(document.getElementById('inner'))).toBe(
      document.scrollingElement ?? document.documentElement,
    );
  });

  it('is safe before the element exists', () => {
    expect(scrollParent(null)).toBeNull();
    expect(() => scrollToBottom(null)).not.toThrow();
  });
});

describe('landing on the newest message', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('scrolls the element that is really scrolling, not the one it was given', () => {
    const outer = build(
      '<div style="overflow-y: auto"><div id="pane" style="overflow-y: auto"></div></div>',
    );
    const pane = document.getElementById('pane')!;
    size(outer, 700, 4000);
    size(pane, 4000, 4000);

    scrollToBottom(pane);

    expect(outer.scrollTop).toBe(4000);
    // The pane was the obvious target and the wrong one; writing to it is
    // what made this fail silently in the first place.
    expect(pane.scrollTop).toBe(0);
  });

  it('scrolls the pane itself when the pane is the one scrolling', () => {
    const outer = build('<div><div id="pane" style="overflow-y: auto"></div></div>');
    const pane = document.getElementById('pane')!;
    size(pane, 350, 3800);

    scrollToBottom(pane);

    expect(pane.scrollTop).toBe(3800);
  });
});
