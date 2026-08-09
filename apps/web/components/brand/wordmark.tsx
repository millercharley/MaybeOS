/**
 * The MaybeOS wordmark, set as live text rather than an image.
 *
 * Young Serif is the wordmark's own typeface, so setting it as text keeps it
 * sharp at any size, lets it inherit `currentColor` (so it works on paper and
 * on ink without a second asset), and keeps it readable by screen readers.
 *
 * Form follows the supplied asset: "Maybe" in the serif with "OS" raised as a
 * smaller grotesk superscript. The mark is always monochrome — the accent red
 * is never used inside it.
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-display leading-none tracking-tight ${className}`}>
      Maybe
      <span
        className="font-sans font-semibold"
        style={{
          fontSize: '0.42em',
          verticalAlign: 'super',
          letterSpacing: '-0.01em',
          marginLeft: '0.02em',
        }}
      >
        OS
      </span>
    </span>
  );
}
