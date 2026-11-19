/**
 * @jest-environment node
 *
 * `renderToStaticMarkup` reaches for `MessageChannel`, which the suite's
 * jsdom environment does not provide — and there is no DOM to need here,
 * since this renders to a string.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { EventTabs } from '@/components/events/event-tabs';

/**
 * The pills as they actually come out (EVT-63).
 *
 * Every other test on this screen reads the page's source, which is right
 * for a client component full of hooks — but it means the one thing nobody
 * had checked was the markup. `EventTabs` takes props and returns elements,
 * so it can simply be rendered, and a third pill arriving in the wrong place
 * or without its count is exactly the kind of mistake a source scan passes.
 *
 * Deliberately not a snapshot: a snapshot of this would record the classes
 * too, and they are allowed to change.
 */
describe('the tab pills, rendered', () => {
  const html = (props: Partial<Parameters<typeof EventTabs>[0]> = {}) =>
    renderToStaticMarkup(
      <EventTabs
        tab="upcoming"
        onTab={() => {}}
        counts={{ upcoming: 7, past: 94, draft: 1 }}
        search=""
        onSearch={() => {}}
        extraTabs={[{ key: 'draft', label: 'Drafts' }]}
        {...props}
      />,
    );

  const order = (markup: string) =>
    ['Upcoming', 'Past', 'Drafts'].map((label) => markup.indexOf(label));

  it('puts Drafts after the two time tabs, never between them', () => {
    const [upcoming, past, drafts] = order(html());

    expect(upcoming).toBeGreaterThan(-1);
    expect(past).toBeGreaterThan(upcoming);
    expect(drafts).toBeGreaterThan(past);
  });

  it('shows the count on the Drafts pill', () => {
    // One, not fifty-two: the whole argument for filtering by standing.
    expect(html()).toMatch(/Drafts<span[^>]*>1</);
  });

  it('shows no number rather than a zero', () => {
    const markup = html({ counts: { upcoming: 7, past: 94, draft: 0 } });

    expect(markup).toContain('Drafts');
    expect(markup).not.toMatch(/Drafts<span[^>]*>0</);
  });

  it('marks only the open tab as selected', () => {
    const markup = html({ tab: 'draft' });
    const selected = [...markup.matchAll(/aria-selected="true"/g)];

    expect(selected).toHaveLength(1);
    expect(markup).toMatch(/aria-selected="true"[^>]*>Drafts/);
  });

  it('renders the two tabs alone when no screen asks for a third', () => {
    const markup = html({ extraTabs: undefined });

    expect(markup).toContain('Upcoming');
    expect(markup).not.toContain('Drafts');
  });
});
