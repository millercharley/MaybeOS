/**
 * @jest-environment jsdom
 */
import { parsePlanIntent, savePlanIntent, takePlanIntent } from '../lib/plan-intent';

describe('the plan chosen on the landing page', () => {
  beforeEach(() => localStorage.clear());

  it('accepts only the paid plans and real intervals', () => {
    expect(parsePlanIntent('plus', 'year')).toEqual({ plan: 'PLUS', interval: 'year' });
    expect(parsePlanIntent('UNLIMITED', null)).toEqual({ plan: 'UNLIMITED', interval: 'month' });
    expect(parsePlanIntent('free', 'month')).toBeNull();
    expect(parsePlanIntent('plus', 'weekly')).toBeNull();
  });

  it('is acted on once', () => {
    savePlanIntent({ plan: 'PLUS', interval: 'year' });
    expect(takePlanIntent()).toEqual({ plan: 'PLUS', interval: 'year' });
    expect(takePlanIntent()).toBeNull();
  });

  it('is forgotten after a day', () => {
    savePlanIntent({ plan: 'PLUS', interval: 'month' }, 0);
    expect(takePlanIntent(25 * 60 * 60 * 1000)).toBeNull();
  });
});
