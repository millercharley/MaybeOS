import Image from 'next/image';
import wordmarkSrc from '@/public/brand/wordmark.png';

type Tone = 'ink' | 'paper';

interface WordmarkProps {
  /**
   * Which ground the mark sits on.
   * - `ink` (default) — the supplied black artwork, unmodified, for paper.
   * - `paper` — inverted for dark ink fields (the admin sidebar). The source
   *   art is a single black asset with no light-on-dark variant, so it is
   *   inverted rather than swapped. Replace this with a second asset if a
   *   dedicated reversed cut is ever produced.
   */
  tone?: Tone;
  /** Rendered height in px. Width is derived from the asset's aspect ratio. */
  height?: number;
  className?: string;
}

const ASPECT = 925 / 326; // intrinsic dimensions of the supplied artwork

export function Wordmark({
  tone = 'ink',
  height = 26,
  className = '',
}: WordmarkProps) {
  return (
    <Image
      src={wordmarkSrc}
      alt="MaybeOS"
      height={height}
      width={Math.round(height * ASPECT)}
      priority
      className={className}
      style={tone === 'paper' ? { filter: 'invert(1)' } : undefined}
    />
  );
}
