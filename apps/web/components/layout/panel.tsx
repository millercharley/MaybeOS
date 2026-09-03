import type { ReactNode } from 'react';

/**
 * A section of a page, on a card (BRD-02).
 *
 * Charley, with the Members page as the model: "every page should have panels
 * where all of the text runs in the panel or cards. These cards and panels sit
 * over the background. This makes it so it doesn't matter what color an admin
 * picks, everything remains readable inside the panels and cards."
 *
 * The page headline is the one exception — on Members, the title and its
 * buttons sit on the background and every other word is on a card. Everything
 * that is not the headline belongs in one of these.
 *
 * The reason it matters here more than on a normal page: a co-op chooses the
 * colour behind all of this, and a section heading left loose on it is
 * legible or not depending on a choice made in a colour picker weeks earlier.
 * A card takes that out of the co-op's hands.
 */
export function Panel({
  title,
  description,
  actions,
  children,
  className = '',
  bodyClassName = '',
}: {
  /** The section heading. Sans, not the display serif — that is page titles. */
  title?: ReactNode;
  /** One line under it, inside the card with everything else. */
  description?: ReactNode;
  /** Controls for this section, right-aligned beside the heading. */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** For a body that manages its own padding, like a full-bleed table. */
  bodyClassName?: string;
}) {
  const hasHead = Boolean(title || description || actions);

  return (
    <section className={`card ${className}`.trim()}>
      {hasHead && (
        <div
          className={`flex flex-wrap items-start justify-between gap-3 ${children ? 'mb-4' : ''}`}
        >
          <div className="min-w-0">
            {title && <h2 className="text-lg font-semibold">{title}</h2>}
            {description && (
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{description}</p>
            )}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children && <div className={bodyClassName}>{children}</div>}
    </section>
  );
}
