import { portalRequiresAuth } from '@/lib/portal-access';

/**
 * The portal's door (2026-09-04).
 *
 * Charley: signing out must block `/portal/maybeitsfate/rooms` and send you to
 * the login screen. The risk in doing that is over-closing — two portal
 * addresses are meant to be opened by people who are not members, and both are
 * things a co-op sends *out*: a link to an event, and a report to a funder.
 * Closing either would look like the guard working.
 */
describe('who the portal lets in', () => {
  it('sends a signed-out visitor away from a co-op’s inside', () => {
    expect(portalRequiresAuth('/portal/maybeitsfate/rooms')).toBe(true);
    expect(portalRequiresAuth('/portal/maybeitsfate/commons')).toBe(true);
    expect(portalRequiresAuth('/portal/maybeitsfate/directory')).toBe(true);
    expect(portalRequiresAuth('/portal/maybeitsfate/messages/abc')).toBe(true);
    expect(portalRequiresAuth('/portal/maybeitsfate/serve')).toBe(true);
    expect(portalRequiresAuth('/portal/maybeitsfate/welcome')).toBe(true);
  });

  it('closes the co-op’s own front page too', () => {
    expect(portalRequiresAuth('/portal/maybeitsfate')).toBe(true);
    expect(portalRequiresAuth('/portal')).toBe(true);
  });

  it('leaves a shared event link open — it is meant to travel', () => {
    // Charley's rule: event links can be public on social for people to RSVP
    // and buy tickets. The buyer is usually not a member.
    expect(portalRequiresAuth('/portal/maybeitsfate/events')).toBe(false);
    expect(portalRequiresAuth('/portal/maybeitsfate/events/summer-social')).toBe(false);
  });

  it('leaves a published impact report open — a funder is not a member', () => {
    expect(portalRequiresAuth('/portal/maybeitsfate/reports/2026-q1')).toBe(false);
  });

  it('closes a portal section nobody has thought about yet', () => {
    // The allowlist means a section added later is private until somebody
    // deliberately opens it. That is the direction this should fail in.
    expect(portalRequiresAuth('/portal/maybeitsfate/something-new')).toBe(true);
  });

  it('says nothing about addresses outside the portal', () => {
    expect(portalRequiresAuth('/orgs/maybeitsfate')).toBe(false);
    expect(portalRequiresAuth('/login')).toBe(false);
    expect(portalRequiresAuth('/')).toBe(false);
    expect(portalRequiresAuth(null)).toBe(false);
  });
});
