import type { SupportArticle } from '@/lib/api';

/**
 * Finding the right page in MaybeOS's documentation (PLT-05).
 *
 * Charley: "The documentation should be searchable."
 *
 * Done over the articles already in hand rather than across the wire. The
 * whole set is a dozen pages: a round trip per keystroke would be slower than
 * the search, and an organiser looking for "sign-in links" wants the answer
 * while they are still typing it.
 *
 * Pure, because what makes a search feel right is the ranking, and ranking is
 * exactly the sort of judgement that is easier to test than to eyeball.
 */

/** Strip the HTML so a search for "waitlist" is not beaten by `<li>`. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * How well an article answers a query, or zero if it does not.
 *
 * A title match beats a summary match beats a body match, because somebody
 * typing "door" wants the article called Door codes rather than the one that
 * mentions a door in passing. Every word has to appear somewhere, so a
 * two-word query narrows rather than widens.
 */
export function score(article: SupportArticle, query: string): number {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;

  const title = article.title.toLowerCase();
  const summary = (article.summary ?? '').toLowerCase();
  const body = plainText(article.body).toLowerCase();
  const category = article.category.toLowerCase();

  let total = 0;
  for (const word of words) {
    const inTitle = title.includes(word);
    const inSummary = summary.includes(word);
    const inBody = body.includes(word);
    const inCategory = category.includes(word);

    // Every word must land somewhere, or the article is not an answer.
    if (!inTitle && !inSummary && !inBody && !inCategory) return 0;

    if (inTitle) total += 10;
    if (inSummary) total += 4;
    if (inCategory) total += 2;
    if (inBody) total += 1;
  }

  return total;
}

/** The articles that answer a query, best first. Everything, when it is blank. */
export function search(articles: SupportArticle[], query: string): SupportArticle[] {
  const text = query.trim();
  if (!text) return articles;

  return articles
    .map((article) => ({ article, score: score(article, text) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((hit) => hit.article);
}

/** The categories present, in the order the articles give them. */
export function categoriesOf(articles: SupportArticle[]): string[] {
  const seen: string[] = [];
  for (const article of articles) {
    if (!seen.includes(article.category)) seen.push(article.category);
  }
  return seen;
}
