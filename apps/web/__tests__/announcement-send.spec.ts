import { MAX_PASSES, progressLine, shouldContinue, type Pass } from '@/lib/announcement-send';

/**
 * Driving a roster-sized send from the browser (CMN-21).
 *
 * Three ways this goes wrong and all of them are visible to an organiser
 * watching four hundred emails leave: stopping early and saying it finished,
 * never stopping at all, and reporting a number that is not true.
 */
const pass = (over: Partial<Pass> = {}): Pass => ({ sent: 150, total: 150, remaining: 244, ...over });

describe('whether to ask the server again', () => {
  it('continues while there is work and progress', () => {
    expect(shouldContinue(pass(), 1)).toBe(true);
  });

  it('stops when nothing is left', () => {
    expect(shouldContinue(pass({ remaining: 0 }), 1)).toBe(false);
  });

  /**
   * A pass that sent nothing while claiming work remains will send nothing
   * next time either — every member it could reach, it reached. Continuing
   * is an infinite loop against a live mail provider.
   */
  it('stops when a pass sent nobody', () => {
    expect(shouldContinue(pass({ sent: 0, remaining: 244 }), 1)).toBe(false);
  });

  it('stops at the ceiling however much is left', () => {
    expect(shouldContinue(pass(), MAX_PASSES)).toBe(false);
    expect(shouldContinue(pass(), MAX_PASSES + 5)).toBe(false);
  });

  it('allows enough passes for a roster several times MaybeItsFate’s', () => {
    // 394 members at roughly 150 a pass is three.
    expect(MAX_PASSES).toBeGreaterThanOrEqual(10);
  });
});

describe('what the organiser is told', () => {
  it('counts up while it runs', () => {
    expect(progressLine(pass({ total: 150, remaining: 244 }), false)).toBe('Sending… 150 of 394');
  });

  it('says who it reached when it finishes', () => {
    expect(progressLine({ sent: 94, total: 394, remaining: 0 }, true)).toBe(
      'Sent to 394 members.',
    );
  });

  it('says member, singular, for one', () => {
    expect(progressLine({ sent: 1, total: 1, remaining: 0 }, true)).toBe('Sent to 1 member.');
  });

  /** Stopping with work left must not read as success. */
  it('admits it when it stops with people left', () => {
    const line = progressLine({ sent: 0, total: 150, remaining: 244 }, true);

    expect(line).toContain('244 left');
    expect(line).toMatch(/press again/i);
  });
});
