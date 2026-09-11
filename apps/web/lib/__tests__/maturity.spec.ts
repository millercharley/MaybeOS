import { MATURITY_LEVELS, maturityBadge } from '../maturity';

/**
 * Who a booking or event is suitable for (SPC-22).
 */
describe('maturity levels', () => {
  it('offers exactly the four answers, all ages first', () => {
    // First, because it is preselected: the host with nothing to say should
    // not have to go looking for the answer that says nothing.
    expect(MATURITY_LEVELS.map((m) => m.label)).toEqual(['All ages', '13+', '18+', '21+']);
  });

  it('badges only the restricting answers', () => {
    expect(maturityBadge('AGES_13_PLUS')).toBe('13+');
    expect(maturityBadge('AGES_18_PLUS')).toBe('18+');
    expect(maturityBadge('AGES_21_PLUS')).toBe('21+');
  });

  it('gives no badge for all ages, or for no answer at all', () => {
    // A badge on every card saying "All ages" trains people to stop reading
    // badges — the same reason "cost at the door" only appears when true.
    expect(maturityBadge('ALL_AGES')).toBeNull();
    expect(maturityBadge(undefined)).toBeNull();
    expect(maturityBadge(null)).toBeNull();
  });
});
