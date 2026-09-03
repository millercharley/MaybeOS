import type { ReactNode } from 'react';

/**
 * The heading at the top of every page (UI-02).
 *
 * There were seventeen different ones. "Events" was set in the display serif
 * and "Member Directory" in bold sans on the very next page, so moving between
 * two screens of the same product looked like moving between two products.
 * Charley, 2026-09-03: "The goal is consistency, so that as a user switches
 * pages within MaybeOS it feels like the same app."
 *
 * A component rather than a documented class list, because a class list is a
 * thing each page copies and each copy drifts — which is exactly how there came
 * to be seventeen. `design-guide.spec.ts` fails the suite when a page writes
 * its own `<h1>` instead of using this.
 *
 * The display serif is the brand's masthead note and this is the one place the
 * app uses it at page level; everything below a page title is sans, which is
 * what keeps it a masthead rather than a theme.
 */
export function PageHeader({
  title,
  description,
  actions,
  className = '',
}: {
  title: ReactNode;
  /** One line under the title. Optional, and most pages should have one. */
  description?: ReactNode;
  /** Buttons for the page as a whole. They wrap under the title on a phone. */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={`mb-6 flex flex-wrap items-start justify-between gap-3 ${className}`.trim()}
    >
      <div className="min-w-0">
        <h1 className="font-display text-2xl leading-tight text-ink">{title}</h1>
        {description && (
          // Capped, deliberately: the page body fills 1280 but a line of prose
          // read across 1280 pixels is a line people lose their place in.
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
            {description}
          </p>
        )}
      </div>

      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
