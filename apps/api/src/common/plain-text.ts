/**
 * A member's rich text, reduced to words.
 *
 * Everything members write in the Commons composer is HTML — paragraphs,
 * lists, links, pasted formatting (CMP-01). An email template escapes what it
 * is given, which is right and must stay that way: unescaped, a member's
 * markup would land inside ours. But escaping HTML shows the markup, so a
 * notification arrives reading literally
 *
 *   <p>Hey Charlie! Thank you so much for approving the Main Gallery…</p> <ol> <li>
 *
 * which is what a member saw on 20 November. The content has to be turned
 * into text *before* it reaches a template, and that is this.
 *
 * `excerptOf` in `thread-policy.ts` had this right for comment replies
 * (CMN-22) and its docblock spells the trap out exactly. The direct-message
 * preview and the weekly digest's untitled-post fallback were written
 * separately and never got it — the same shape as the null-byte bug the same
 * week, where the two query parameters that had been reported were fixed and
 * the two that had not were left. So the conversion lives here, once, and the
 * three callers do their own truncation, which genuinely does differ.
 *
 * Strip tags *before* decoding entities, never the other way round: decoding
 * first would turn a member's literal `&lt;script&gt;` into a tag and then
 * remove it, silently eating text they typed.
 */
export function plainTextOf(html: string): string {
  return (
    html
      // Block-level ends become spaces, so two paragraphs do not run together
      // into one word.
      .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim()
  );
}
