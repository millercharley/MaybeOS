import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../../../common/testing/source-scan';
import {
  canSeeChannel,
  visibleChannelRelation,
  visibleChannelWhere,
} from '../channel-visibility';

/**
 * A channel marked not-public is now actually not public (CMN-30).
 *
 * `Channel.isPublic` existed from the day the Commons was built. Create
 * defaulted it, update wrote it, both DTOs accepted it from a client — and
 * nothing read it. The schema admitted as much on `memberChannelsEnabled`:
 * "Channels are open to the whole co-op either way — see `Channel.isPublic`,
 * which nothing enforces."
 *
 * The card called it dead code. It was worse than dead: a switch that
 * reported success and did nothing, which is how somebody writes something
 * they believe is private in front of four hundred people.
 *
 * **Organisers only**, not "these particular members" — there is no channel
 * membership in the schema, and `inviteToChannel` only sends a direct
 * message saying "come and join". That limit is deliberate and documented.
 */
describe('who can see a private channel', () => {
  const member = { isStaff: false };
  const organiser = { isStaff: true };

  it('shows a public channel to everybody', () => {
    expect(canSeeChannel({ isPublic: true }, member)).toBe(true);
    expect(canSeeChannel({ isPublic: true }, organiser)).toBe(true);
  });

  it('hides a private channel from a member', () => {
    expect(canSeeChannel({ isPublic: false }, member)).toBe(false);
  });

  it('shows a private channel to an organiser', () => {
    expect(canSeeChannel({ isPublic: false }, organiser)).toBe(true);
  });
});

describe('the clause that does the hiding', () => {
  it('narrows a member to public channels', () => {
    expect(visibleChannelWhere({ isStaff: false })).toEqual({ isPublic: true });
  });

  it('adds nothing for an organiser, so their query is the one it always was', () => {
    expect(visibleChannelWhere({ isStaff: true })).toEqual({});
  });

  it('reads the same through a relation', () => {
    // A post, a comment and a proposal all reach their channel this way.
    expect(visibleChannelRelation({ isStaff: false })).toEqual({ isPublic: true });
    expect(visibleChannelRelation({ isStaff: true })).toEqual({});
  });
});

/**
 * Enforced where it cannot be forgotten.
 *
 * Seventeen call sites resolve a channel, a post, a comment or a proposal,
 * and every one of them goes through one of four scoped finders. The clause
 * lives there, beside the org clause, for the reason SEC-04 gives: a rule
 * enforced in one place is a rule, and a rule enforced in seventeen is a
 * rule with sixteen chances to be missed.
 */
describe('the service enforces it at the chokepoints', () => {
  const source = stripComments(
    readFileSync(join(__dirname, '..', 'commons.service.ts'), 'utf8'),
  );

  /*
    One method's body, by name.

    Not a fixed number of characters: `stripComments` blanks comments but
    keeps their length so a failure still points at the right line, and this
    file documents itself heavily — a 400-character window landed in the
    middle of a paragraph about the bug rather than the code that fixes it.
  */
  const methodBody = (name: string) => {
    const start = source.indexOf(name);
    const rest = source.slice(start + name.length);
    const end = rest.search(/\n {2}(?:private |public )?(?:async )?[a-zA-Z_]\w*\s*\(/);
    return rest.slice(0, end === -1 ? undefined : end);
  };

  it('gates all four scoped finders', () => {
    for (const finder of [
      'findChannelInOrg',
      'findPostInOrg',
      'findCommentInOrg',
      'findProposalInOrg',
    ]) {
      const body = source.slice(source.indexOf(`private async ${finder}`));
      const clause = body.slice(0, body.indexOf('});'));

      expect({ finder, gated: /visibleChannel(Where|Relation)\(viewer\)/.test(clause) }).toEqual({
        finder,
        gated: true,
      });
    }
  });

  it('hides a private channel from the sidebar list', () => {
    /*
      The leak that mattered most. Even with every post locked away, the
      list named every channel in the co-op — so the *existence* of
      "#safeguarding" was public, which is most of what was being kept.
    */
    expect(methodBody('async listChannels')).toMatch(/visibleChannelWhere\(viewer\)/);
  });

  it('keeps a private channel out of the unread badge', () => {
    // An ungated badge counts posts a member may not read, against a
    // channel id they cannot open — a number they can never clear.
    expect(methodBody('private async unreadInCommons')).toMatch(
      /visibleChannelWhere\(viewer\)/,
    );
  });

  it('will not let a member mark a private channel read', () => {
    expect(methodBody('async markChannelRead')).toMatch(/visibleChannelWhere\(viewer\)/);
  });

  it('refuses by answering NotFound, never Forbidden', () => {
    /*
      A 403 on a channel a member may not see confirms that it exists,
      which is most of the secret. Same choice as SpaceOS bookings and
      D-009, and the comment above the finders already said so for the org
      clause.
    */
    const finders = source.slice(
      source.indexOf('private async findChannelInOrg'),
      source.indexOf('private async findCollectionInOrg'),
    );

    expect(finders).not.toMatch(/ForbiddenException/);
    expect(finders.match(/NotFoundException/g) ?? []).toHaveLength(4);
  });
});
