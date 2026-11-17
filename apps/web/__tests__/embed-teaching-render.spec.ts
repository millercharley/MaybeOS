/**
 * The teaching embed, actually rendering (TCH-01).
 *
 * `embed.js` is the one file in MaybeOS that runs on somebody else's website,
 * where nothing we own is watching it. It ships as plain ES5 with no build
 * step and no type checking, so this executes the real file — read off disk,
 * not a copy — against a stubbed feed.
 *
 * The thing it is really guarding is the same thing the membership suite
 * guards: a tag already pasted on a co-op's site keeps rendering events. A
 * third block must not change what the first two do.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = readFileSync(join(process.cwd(), 'public', 'embed.js'), 'utf8');

const TEACHING = {
  org: { name: 'Sunrise', slug: 'sunrise', brandColor: '#b03030' },
  offerings: [
    {
      kind: 'WORKSHOP',
      title: 'Beginner wheel throwing',
      slug: 'beginner-wheel-throwing',
      summary: 'Four Tuesdays, no experience needed.',
      teacher: { name: 'Ada Lovelace' },
      priceCents: 4000,
      currency: 'usd',
      url: 'https://maybeos.org/portal/sunrise/teaching/beginner-wheel-throwing',
      sessions: [
        { startTime: '2026-12-01T18:00:00.000Z', endTime: '2026-12-01T20:00:00.000Z' },
      ],
    },
    {
      kind: 'PRIVATE_LESSON',
      title: 'Piano lessons',
      slug: 'piano-lessons',
      teacher: { name: 'Grace Hopper' },
      priceNote: 'Sliding scale, $30–60',
      url: 'https://maybeos.org/portal/sunrise/teaching/piano-lessons',
      sessions: [],
    },
    {
      kind: 'WORKSHOP',
      title: 'Darkroom printing',
      slug: 'darkroom-printing',
      teacher: { name: 'Ansel' },
      url: 'https://maybeos.org/portal/sunrise/teaching/darkroom-printing',
      sessions: [],
    },
  ],
};

function render(attrs: Record<string, string>, payload: unknown, fails = false) {
  const fetchMock = fails
    ? jest.fn().mockRejectedValue(new Error('offline'))
    : jest.fn().mockResolvedValue({ ok: true, json: async () => payload });
  (global as unknown as { fetch: unknown }).fetch = fetchMock;

  document.body.innerHTML = '<div id="slot"></div>';
  const slot = document.getElementById('slot')!;
  const script = document.createElement('script');
  Object.entries(attrs).forEach(([k, v]) => script.setAttribute(k, v));
  Object.defineProperty(script, 'src', { value: 'https://maybeos.org/embed.js' });
  slot.appendChild(script);
  Object.defineProperty(document, 'currentScript', { value: script, configurable: true });

  // eslint-disable-next-line no-eval
  eval(SOURCE);

  const host = slot.querySelector('div');
  return { fetchMock, shadow: () => host!.shadowRoot! };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('which feed a tag asks for', () => {
  it('asks for teaching when that is what the admin copied', async () => {
    const { fetchMock } = render(
      { 'data-org': 'sunrise', 'data-show': 'teaching' },
      TEACHING,
    );
    await flush();

    expect(fetchMock).toHaveBeenCalledWith('https://maybeos.org/api/embed/sunrise/teaching');
  });

  /**
   * The guard that matters most. Every tag pasted before this file learned a
   * third trick carries no `data-show`, and must keep meaning events.
   */
  it('still asks for events when nothing says otherwise', async () => {
    const { fetchMock } = render({ 'data-org': 'sunrise' }, { events: [] });
    await flush();

    expect(fetchMock).toHaveBeenCalledWith('https://maybeos.org/api/embed/sunrise/events');
  });

  it('falls back to events on a value it does not know', async () => {
    const { fetchMock } = render(
      { 'data-org': 'sunrise', 'data-show': 'nonsense' },
      { events: [] },
    );
    await flush();

    expect(fetchMock).toHaveBeenCalledWith('https://maybeos.org/api/embed/sunrise/events');
  });

  it('leaves membership alone', async () => {
    const { fetchMock } = render(
      { 'data-org': 'sunrise', 'data-show': 'membership' },
      { tiers: [] },
    );
    await flush();

    expect(fetchMock).toHaveBeenCalledWith('https://maybeos.org/api/embed/sunrise/membership');
  });
});

describe('what a visitor sees', () => {
  const draw = async () => {
    const { shadow } = render({ 'data-org': 'sunrise', 'data-show': 'teaching' }, TEACHING);
    await flush();
    return shadow();
  };

  it('draws a card for every offering', async () => {
    expect((await draw()).querySelectorAll('.offering')).toHaveLength(3);
  });

  it('names what it is, who teaches it and what it costs', async () => {
    const text = (await draw()).textContent ?? '';

    expect(text).toContain('Beginner wheel throwing');
    expect(text).toContain('with Ada Lovelace');
    expect(text).toContain('Four Tuesdays, no experience needed.');
    expect(text).toContain('$40.00');
  });

  it('calls a workshop a workshop and lessons lessons', async () => {
    const kinds = [...(await draw()).querySelectorAll('.offering-kind')].map(
      (node) => node.textContent,
    );

    expect(kinds).toEqual(['Workshop', 'Private lessons', 'Workshop']);
  });

  /**
   * "Pay what you can" is an answer and "$0.00" is not, so a teacher's own
   * words beat the figure — the same order the app uses.
   */
  it('prefers the teacher’s own words about money', async () => {
    expect((await draw()).textContent).toContain('Sliding scale, $30–60');
  });

  /**
   * A workshop with no dates says so rather than going quiet: "nothing
   * scheduled yet" is the answer that makes somebody get in touch.
   */
  it('says when a workshop has no dates, and never dates a lesson', async () => {
    const metas = [...(await draw()).querySelectorAll('.offering-meta')].map(
      (node) => node.textContent ?? '',
    );

    expect(metas[1]).toContain('Arranged with you');
    expect(metas[2]).toContain('No dates yet');
    expect(metas[2]).toContain('Free');
  });

  it('follows the url the feed gave it, in a new tab', async () => {
    const first = (await draw()).querySelector('.offering') as HTMLAnchorElement;

    expect(first.href).toBe(
      'https://maybeos.org/portal/sunrise/teaching/beginner-wheel-throwing',
    );
    expect(first.target).toBe('_blank');
    expect(first.rel).toBe('noopener');
  });

  it('says something rather than nothing when a co-op teaches nothing yet', async () => {
    const { shadow } = render(
      { 'data-org': 'sunrise', 'data-show': 'teaching' },
      { org: { name: 'Sunrise', slug: 'sunrise' }, offerings: [] },
    );
    await flush();

    expect(shadow().textContent).toContain('Nothing is being taught here just yet');
  });

  it('is quiet about a failure rather than showing a stack trace', async () => {
    const { shadow } = render(
      { 'data-org': 'sunrise', 'data-show': 'teaching' },
      null,
      true,
    );
    await flush();

    expect(shadow().textContent).toContain('Workshops and lessons are unavailable right now');
  });
});

/**
 * The rules this file keeps everywhere, checked on the new block too.
 */
describe('the house rules, on the new block', () => {
  it('writes text with textContent, never innerHTML', () => {
    const teaching = SOURCE.slice(
      SOURCE.indexOf('var teachingCard'),
      SOURCE.indexOf('var renderMembership'),
    );

    expect(teaching).not.toContain('innerHTML');
  });

  /**
   * The raw accent is a colour an admin picked and may be unreadable on
   * white; `accentText` is the darkened one. Other suites assert the raw
   * value never fills a button, and the same applies here.
   */
  it('colours its text with the readable accent, not the raw one', () => {
    expect(SOURCE).toContain(".offering-kind { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ' + accentText + '");
  });

  /** The script holds no rule about MaybeOS's address shape. */
  it('builds no MaybeOS addresses of its own', () => {
    const teaching = SOURCE.slice(
      SOURCE.indexOf('var teachingCard'),
      SOURCE.indexOf('var renderMembership'),
    );

    expect(teaching).not.toContain('/portal/');
    expect(teaching).toContain('linkTo(offering');
  });
});
