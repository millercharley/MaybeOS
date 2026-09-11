/**
 * Who a booking or event is suitable for (SPC-22).
 *
 * Asked of the host when a room is booked, carried onto the event if the
 * booking is published, and editable on the event after. One list, so the
 * booking form, the event form and every badge say the same four things.
 */
export type MaturityLevel = 'ALL_AGES' | 'AGES_13_PLUS' | 'AGES_18_PLUS' | 'AGES_21_PLUS';

export const MATURITY_LEVELS: ReadonlyArray<{ value: MaturityLevel; label: string }> = [
  { value: 'ALL_AGES', label: 'All ages' },
  { value: 'AGES_13_PLUS', label: '13+' },
  { value: 'AGES_18_PLUS', label: '18+' },
  { value: 'AGES_21_PLUS', label: '21+' },
];

/**
 * The short badge, or null for all ages.
 *
 * All ages is the norm, and a badge on every card saying so trains people to
 * stop reading badges — the same reason "cost to attend" only appears when
 * there is one. The restricting answers are the ones someone has to notice.
 */
export function maturityBadge(level?: MaturityLevel | null): string | null {
  if (!level || level === 'ALL_AGES') return null;
  return MATURITY_LEVELS.find((m) => m.value === level)?.label ?? null;
}
