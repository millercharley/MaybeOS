/**
 * The membership embed, actually rendering (PUB-01).
 *
 * `embed.js` is the one file in MaybeOS that runs on somebody else's website,
 * where nothing we own is watching it. It ships as plain ES5 in `public/` with
 * no build step and no type checking, so this executes the real file — read
 * off disk, not a copy — against a stubbed feed.
 *
 * What it is really guarding: that a tag already pasted on a co-op's site
 * keeps rendering events. `data-show` is new; absent has to keep meaning what
 * it meant before this file learned a second trick.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = readFileSync(join(process.cwd(), 'public', 'embed.js'), 'utf8');

const MEMBERSHIP = {
  name: 'Sunrise',
  slug: 'sunrise',
  allowPublicJoin: true,
  tiers: [
    {
      id: 'tier-1',
      name: 'Sustainer',
      description: 'Standard membership',
      priceMonthly: 1950,
      isPayWhatYouCan: false,
      benefits: ['Reserve rooms', 'Voting rights'],
    },
    { id: 'tier-2', name: 'Free Member', priceMonthly: 0, isPayWhatYouCan: false, benefits: [] },
  ],
};

const EVENTS = { events: [{ title: 'Open studio', startTime: '2026-10-01T18:00:00.000Z' }] };

/** Run the real script with the attributes a co-op would have pasted. */
function render(attrs: Record<string, string>, payload: unknown, fails = false) {
  const fetchMock = fails
    ? jest.fn().mockRejectedValue(new Error('offline'))
    : jest.fn().mockResolvedValue({ ok: true, json: async () => payload });
  (global as unknown as { fetch: unknown }).fetch = fetchMock;

  document.body.innerHTML = '<div id="slot"></div>';
  const slot = document.getElementById('slot')!;
  const script = document.createElement('script');
  Object.entries(attrs).forEach(([k, v]) => script.setAttribute(k, v));
  // jsdom will not execute a script with a src, and the file reads its own src
  // to find the API — so the element is placed and currentScript is stood in
  // for, which is exactly the state the browser hands the real script.
  Object.defineProperty(script, 'src', { value: 'https://maybeos.org/embed.js' });
  slot.appendChild(script);
  Object.defineProperty(document, 'currentScript', { value: script, configurable: true });

  // eslint-disable-next-line no-eval
  eval(SOURCE);

  const host = slot.querySelector('div');
  return { fetchMock, shadow: () => host!.shadowRoot! };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the membership embed', () => {
  it('asks the membership endpoint for the co-op in the tag', () => {
    const { fetchMock } = render({ 'data-org': 'sunrise', 'data-show': 'membership' }, MEMBERSHIP);

    expect(fetchMock).toHaveBeenCalledWith('https://maybeos.org/api/embed/sunrise/membership');
  });

  it('renders a card per tier with its price and benefits', async () => {
    const { shadow } = render({ 'data-org': 'sunrise', 'data-show': 'membership' }, MEMBERSHIP);
    await settle();

    const cards = shadow().querySelectorAll('.tier');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('Sustainer');
    expect(cards[0].textContent).toContain('$19.50');
    expect(cards[0].textContent).toContain('Reserve rooms');
    expect(cards[1].textContent).toContain('Free');
  });

  it('sends each Join button to that tier on the join page, in a new tab', async () => {
    const { shadow } = render({ 'data-org': 'sunrise', 'data-show': 'membership' }, MEMBERSHIP);
    await settle();

    const links = shadow().querySelectorAll<HTMLAnchorElement>('.join a');
    expect(links).toHaveLength(2);
    expect(links[0].href).toBe('https://maybeos.org/join?org=sunrise&tier=tier-1');
    expect(links[0].target).toBe('_blank');
    expect(links[0].rel).toBe('noopener');
  });

  it('offers no Join button for an invitation-only co-op, and says why', async () => {
    // A button that leads to a refusal is worse than no button. The prices
    // still show: it is the question the visitor came to answer.
    const { shadow } = render(
      { 'data-org': 'sunrise', 'data-show': 'membership' },
      { ...MEMBERSHIP, allowPublicJoin: false },
    );
    await settle();

    expect(shadow().querySelectorAll('.join a')).toHaveLength(0);
    expect(shadow().querySelectorAll('.tier')).toHaveLength(2);
    expect(shadow().textContent).toContain('invitation only');
  });

  it('renders a co-op’s own text as text', async () => {
    // This runs on the co-op's domain: a tier named with a tag must never
    // become markup there.
    const { shadow } = render(
      { 'data-org': 'sunrise', 'data-show': 'membership' },
      {
        ...MEMBERSHIP,
        tiers: [{ id: 't', name: '<img src=x onerror=alert(1)>', priceMonthly: 0, benefits: [] }],
      },
    );
    await settle();

    expect(shadow().querySelector('img')).toBeNull();
    expect(shadow().textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('says so quietly when the feed is unreachable', async () => {
    // No stack trace on a co-op's marketing site; the visitor can do nothing
    // with one, and a line of text is the whole of what is useful.
    const { shadow } = render(
      { 'data-org': 'sunrise', 'data-show': 'membership' },
      MEMBERSHIP,
      true,
    );
    await settle();

    expect(shadow().textContent).toContain('unavailable');
  });
});

describe('the events embed, unchanged', () => {
  it('is what a tag with no data-show still gets', async () => {
    const { fetchMock, shadow } = render({ 'data-org': 'sunrise' }, EVENTS);
    await settle();

    expect(fetchMock).toHaveBeenCalledWith('https://maybeos.org/api/embed/sunrise/events');
    expect(shadow().textContent).toContain('Open studio');
  });

  it('is also what an unrecognised data-show gets', async () => {
    const { fetchMock } = render({ 'data-org': 'sunrise', 'data-show': 'nonsense' }, EVENTS);

    expect(fetchMock).toHaveBeenCalledWith('https://maybeos.org/api/embed/sunrise/events');
  });
});
