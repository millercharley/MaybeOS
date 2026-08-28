import {
  AVAILABLE_VARIABLES,
  DEFAULT_TEMPLATES,
  REQUIRED_VARIABLES,
  renderTemplate,
  validateTemplate,
  variablesIn,
} from '../belonging-emails';

/**
 * Admin-editable email that cannot be edited into something broken
 * (PRD §5.3).
 *
 * The failure this guards against is quiet and slow: an admin tidies the
 * invitation email, removes the Accept button without realising it was a
 * button, and nobody finds out until a member who wanted to say yes had
 * nothing to click — weeks later, with no error anywhere.
 */
describe('belonging email templates', () => {
  describe('the shipped defaults', () => {
    it('every default is valid by its own rules', () => {
      // Otherwise the first thing an admin sees when they open the editor is
      // a validation error on text they did not write.
      for (const kind of Object.keys(DEFAULT_TEMPLATES) as Array<keyof typeof DEFAULT_TEMPLATES>) {
        const t = DEFAULT_TEMPLATES[kind];
        expect(validateTemplate(kind, t.subject, t.body)).toEqual([]);
      }
    });

    it('every default uses only variables it is offered', () => {
      for (const kind of Object.keys(DEFAULT_TEMPLATES) as Array<keyof typeof DEFAULT_TEMPLATES>) {
        const t = DEFAULT_TEMPLATES[kind];
        const used = new Set([...variablesIn(t.subject), ...variablesIn(t.body)]);
        for (const v of used) {
          expect(AVAILABLE_VARIABLES[kind]).toContain(v);
        }
      }
    });

    it('the invitation offers both an accept and a decline', () => {
      // Declining is a first-class answer, not a non-response. It is what
      // lets the rotation move on immediately instead of waiting 48 hours.
      const used = variablesIn(DEFAULT_TEMPLATES.BUDDY_INVITATION.body);
      expect(used).toContain('accept_url');
      expect(used).toContain('decline_url');
    });

    it('both intros lead to the same single action', () => {
      // §5.3: sending the first message is the success action, so each intro
      // has exactly one primary CTA and it is the DM thread.
      for (const kind of ['INTRO_TO_BUDDY', 'INTRO_TO_NEW_MEMBER'] as const) {
        expect(variablesIn(DEFAULT_TEMPLATES[kind].body).filter((v) => v === 'dm_url')).toHaveLength(1);
      }
    });

    it('the off-the-hook email asks for nothing back', () => {
      // Its entire job is to remove an obligation. A CTA to accept anyway
      // would put the obligation straight back.
      expect(REQUIRED_VARIABLES.OFF_THE_HOOK).toEqual([]);
      expect(variablesIn(DEFAULT_TEMPLATES.OFF_THE_HOOK.body)).not.toContain('accept_url');
    });
  });

  describe('what an admin cannot save', () => {
    it('an invitation with the accept button deleted', () => {
      const problems = validateTemplate(
        'BUDDY_INVITATION',
        'Welcome {{new_member_name}}',
        'Please be a buddy.\n\n{{decline_url}}',
      );
      expect(problems.join(' ')).toContain('accept_url');
    });

    it('an intro with no way to reach the conversation', () => {
      const problems = validateTemplate('INTRO_TO_BUDDY', 'Meet them', 'They seem nice.');
      expect(problems.join(' ')).toContain('dm_url');
    });

    it('a variable that does not exist', () => {
      // Silently dropping it would render an empty space and look like a bug
      // in MaybeOS rather than a typo in the template.
      const problems = validateTemplate(
        'OFF_THE_HOOK',
        'Hello',
        'Sorry {{member_first_name}}.',
      );
      expect(problems.join(' ')).toContain('member_first_name');
      expect(problems.join(' ')).toContain('is not available');
    });

    it('a variable borrowed from a different email', () => {
      const problems = validateTemplate('OFF_THE_HOOK', 'Hello', 'Try {{dm_url}}');
      expect(problems.join(' ')).toContain('not available');
    });

    it('an empty subject or body', () => {
      expect(validateTemplate('OFF_THE_HOOK', '  ', 'Body').join(' ')).toContain('subject');
      expect(validateTemplate('OFF_THE_HOOK', 'Subject', '  ').join(' ')).toContain('message');
    });

    it('a button buried in a sentence', () => {
      const problems = validateTemplate(
        'INTRO_TO_BUDDY',
        'Meet them',
        'You can reach them at {{dm_url}} whenever you like.',
      );
      expect(problems.join(' ')).toContain('line of its own');
    });

    it('reports every problem at once', () => {
      // One problem per save is how an admin gives up on the editor.
      const problems = validateTemplate('BUDDY_INVITATION', '', 'Nothing here {{nope}}');
      expect(problems.length).toBeGreaterThan(2);
    });
  });

  describe('rendering', () => {
    const values = {
      new_member_name: 'Ada',
      community_name: 'Sunrise',
      accept_url: 'https://maybeos.org/buddy/accept/abc',
      decline_url: 'https://maybeos.org/buddy/decline/abc',
      timeout_hours: '48',
    };

    it('substitutes text into the subject', () => {
      const { subject } = renderTemplate(DEFAULT_TEMPLATES.BUDDY_INVITATION, values);
      expect(subject).toBe('Would you welcome Ada to Sunrise?');
    });

    it('turns link variables into real buttons', () => {
      const { html } = renderTemplate(DEFAULT_TEMPLATES.BUDDY_INVITATION, values);
      expect(html).toContain(`href="${values.accept_url}"`);
      expect(html).toContain('Yes, I will');
      expect(html).not.toContain('{{accept_url}}');
    });

    it('escapes a name that contains markup', () => {
      // Names come from members. An admin-authored template plus a
      // member-chosen name must not be a script tag in everyone's inbox.
      const { subject, html } = renderTemplate(DEFAULT_TEMPLATES.BUDDY_INVITATION, {
        ...values,
        new_member_name: '<script>alert(1)</script>',
      });
      expect(subject).not.toContain('<script>');
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes a URL that tries to break out of the attribute', () => {
      const { html } = renderTemplate(DEFAULT_TEMPLATES.BUDDY_INVITATION, {
        ...values,
        accept_url: 'https://x/" onclick="alert(1)',
      });
      expect(html).not.toContain('onclick="alert(1)"');
      expect(html).toContain('&quot;');
    });

    it('renders a missing variable as nothing, never as its own name', () => {
      const { html } = renderTemplate(DEFAULT_TEMPLATES.INTRO_TO_NEW_MEMBER, {
        community_name: 'Sunrise',
        dm_url: 'https://maybeos.org/dm/1',
        // buddy_name deliberately absent
      });
      expect(html).not.toContain('{{buddy_name}}');
      expect(html).not.toContain('buddy_name');
    });

    it('drops a button whose URL is missing rather than linking nowhere', () => {
      // A button that looks live and does nothing is worse than no button.
      const { html } = renderTemplate(DEFAULT_TEMPLATES.INTRO_TO_BUDDY, {
        new_member_name: 'Ada',
        community_name: 'Sunrise',
        dm_url: null,
      });
      expect(html).not.toContain('<a href');
    });

    it('keeps two buttons on separate lines', () => {
      const { html } = renderTemplate(DEFAULT_TEMPLATES.BUDDY_INVITATION, values);
      expect(html).toContain('<br />');
      expect((html.match(/<a href/g) ?? [])).toHaveLength(2);
    });

    it('turns blank lines into paragraphs', () => {
      const { html } = renderTemplate(
        { subject: 'x', body: 'One.\n\nTwo.' },
        {},
      );
      expect((html.match(/<p /g) ?? [])).toHaveLength(2);
    });
  });
});
