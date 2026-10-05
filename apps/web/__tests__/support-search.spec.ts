import { categoriesOf, plainText, score, search } from '@/lib/support-search';
import type { SupportArticle } from '@/lib/api';

/**
 * Finding the right page in MaybeOS's documentation (PLT-05).
 *
 * Charley: "The documentation should be searchable."
 *
 * What makes a search feel right is the ranking, and ranking is the part
 * easiest to get subtly wrong — so these are mostly about which of two
 * plausible answers comes first.
 */
const article = (over: Partial<SupportArticle>): SupportArticle => ({
  id: over.slug ?? 'a',
  slug: over.slug ?? 'a',
  title: 'Door codes',
  summary: 'What the codes are.',
  category: 'Rooms and the building',
  body: '<p>Every member gets a five-letter code.</p>',
  state: 'PUBLISHED',
  position: 0,
  updatedAt: '2026-10-05T00:00:00Z',
  images: [],
  ...over,
});

describe('searching the documentation', () => {
  it('returns everything when nothing is typed', () => {
    const all = [article({ slug: 'a' }), article({ slug: 'b' })];
    expect(search(all, '')).toHaveLength(2);
    expect(search(all, '   ')).toHaveLength(2);
  });

  it('puts the article named after the thing first', () => {
    // Somebody typing "door" wants the page called Door codes, not the one
    // that mentions a door in passing.
    const named = article({ slug: 'door-codes', title: 'Door codes' });
    const mentions = article({
      slug: 'rooms',
      title: 'Rooms and bookings',
      summary: 'Holding a space.',
      body: '<p>Members come in through the door.</p>',
    });

    expect(search([mentions, named], 'door')[0].slug).toBe('door-codes');
  });

  it('narrows as more words are typed, rather than widening', () => {
    const signIn = article({
      slug: 'importing-members',
      title: 'Bringing your members across',
      summary: 'The import and sign-in links.',
      body: '<p>Sign-in links go out in batches.</p>',
    });
    const other = article({ slug: 'tiers', title: 'Tiers', summary: 'Prices.', body: '<p>Links.</p>' });

    const hits = search([signIn, other], 'sign-in links');
    expect(hits).toHaveLength(1);
    expect(hits[0].slug).toBe('importing-members');
  });

  it('finds nothing when a word appears nowhere', () => {
    expect(search([article({})], 'kombucha')).toEqual([]);
  });

  it('matches the category, so browsing by subject works as a search', () => {
    expect(search([article({})], 'migration')).toEqual([]);
    expect(search([article({ category: 'Migration' })], 'migration')).toHaveLength(1);
  });

  it('is not fooled by the markup', () => {
    // A search for "li" must not match every bulleted article.
    const bulleted = article({ body: '<ul><li>Something entirely unrelated</li></ul>' });
    expect(score(bulleted, 'li')).toBe(0);
  });

  it('reads the words out of the HTML', () => {
    expect(plainText('<p>Five-letter <strong>code</strong></p>')).toBe('Five-letter code');
  });
});

describe('the categories', () => {
  it('keeps the order the articles come in', () => {
    const articles = [
      article({ slug: '1', category: 'Getting started' }),
      article({ slug: '2', category: 'Migration' }),
      article({ slug: '3', category: 'Getting started' }),
    ];
    expect(categoriesOf(articles)).toEqual(['Getting started', 'Migration']);
  });
});
