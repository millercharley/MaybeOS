import DOMPurify from 'isomorphic-dompurify';

/**
 * Wiki page bodies are HTML, and this is the only thing allowed to render them.
 *
 * The bodies come from `CollectionPage.body`, which is authored through an
 * ADMIN-only route — so the trust boundary is "a co-op's own admins". That was
 * a narrow boundary while the wiki was visible only to admins: the same people
 * who could write the HTML were the only ones who could run it.
 *
 * CMN-06 opened the wiki to every member, which widens it considerably. And
 * since SCL-02 shipped self-serve signup, becoming an admin somewhere takes a
 * registration form — so "admin-authored" is no longer a synonym for
 * "trusted". An unsanitised page body would run in every member's browser with
 * their session in scope.
 *
 * Sanitising rather than escaping, because the content genuinely is HTML and
 * escaping it shows people `<p>` tags. Sanitising rather than hand-rolling a
 * tag stripper, because hand-rolled sanitisers are reliably wrong.
 */
export function sanitizeWikiHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'hr',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre', 'blockquote',
      'ul', 'ol', 'li',
      'a', 'img',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
    ],
    ALLOWED_ATTR: ['href', 'title', 'alt', 'src', 'target', 'rel'],
    // No javascript: or data: URLs; http(s), mailto and relative links only.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}
