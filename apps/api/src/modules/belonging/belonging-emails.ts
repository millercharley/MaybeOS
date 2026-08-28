/**
 * The four buddy emails, and the one required-reading email (PRD §5.3, §6.2).
 *
 * Admin-editable text with variable substitution, with shipped defaults used
 * whenever a co-op has not written its own. Absence means "use the default"
 * rather than a stored copy of it, so a co-op that never opens this screen
 * keeps getting improvements to the wording instead of a frozen snapshot of
 * whatever shipped the day they joined.
 *
 * **Bodies are plain text, not HTML.** An admin writing a welcome email is
 * not writing markup, and letting them would put a script tag one paste away
 * from every member's inbox. Text is escaped, blank lines become paragraphs,
 * and the link variables render as real buttons — which also means an admin
 * cannot accidentally produce an email whose Accept button is the literal
 * string "{{accept_url}}".
 */

export type BelongingEmailKindName =
  | 'BUDDY_INVITATION'
  | 'OFF_THE_HOOK'
  | 'INTRO_TO_BUDDY'
  | 'INTRO_TO_NEW_MEMBER'
  | 'REQUIRED_READING';

/**
 * Variables that render as a button rather than as text.
 *
 * Kept as a map so `renderTemplate` never has to guess from the value: a
 * community whose name happens to look like a URL should still be a name.
 */
export const LINK_VARIABLES: Record<string, string> = {
  accept_url: 'Yes, I will',
  decline_url: 'Not this time',
  dm_url: 'Say hello',
  opt_out_url: 'Change my buddy settings',
  article_url: 'Read and agree',
};

/**
 * Which variables each email must keep to still work.
 *
 * Enforced when an admin saves. An invitation without its Accept link is not
 * a worse email, it is a broken one — and it would break silently, weeks
 * later, for a member who is trying to say yes.
 */
export const REQUIRED_VARIABLES: Record<BelongingEmailKindName, string[]> = {
  BUDDY_INVITATION: ['accept_url', 'decline_url'],
  OFF_THE_HOOK: [],
  INTRO_TO_BUDDY: ['dm_url'],
  INTRO_TO_NEW_MEMBER: ['dm_url'],
  REQUIRED_READING: ['article_url'],
};

/** Everything a co-op may use in each email, for the editor's help text. */
export const AVAILABLE_VARIABLES: Record<BelongingEmailKindName, string[]> = {
  BUDDY_INVITATION: ['new_member_name', 'community_name', 'accept_url', 'decline_url', 'timeout_hours'],
  OFF_THE_HOOK: ['new_member_name', 'community_name', 'opt_out_url'],
  INTRO_TO_BUDDY: ['new_member_name', 'buddy_name', 'community_name', 'dm_url'],
  INTRO_TO_NEW_MEMBER: ['new_member_name', 'buddy_name', 'community_name', 'dm_url'],
  REQUIRED_READING: ['community_name', 'article_title', 'article_url', 'grace_days'],
};

export const DEFAULT_TEMPLATES: Record<
  BelongingEmailKindName,
  { subject: string; body: string }
> = {
  BUDDY_INVITATION: {
    subject: 'Would you welcome {{new_member_name}} to {{community_name}}?',
    body: `{{new_member_name}} has just joined {{community_name}}, and we are looking for one person to be their first point of contact.

It is not a job. It means saying hello, answering the questions people are embarrassed to ask, and making sure they know one human being here by name.

{{accept_url}}
{{decline_url}}

If we do not hear from you within {{timeout_hours}} hours we will pass it along to somebody else. There is no need to reply.`,
  },

  OFF_THE_HOOK: {
    subject: 'You are off the hook',
    body: `We asked whether you would welcome {{new_member_name}} to {{community_name}} and did not hear back, so we have passed it to someone else. Nothing is owed and nothing is owing.

If the timing was the problem rather than the asking, we will come back to you another time. If you would rather we did not, you can turn buddy invitations off entirely.

{{opt_out_url}}`,
  },

  INTRO_TO_BUDDY: {
    subject: 'Meet {{new_member_name}}',
    body: `Thank you for saying yes.

{{new_member_name}} has just joined {{community_name}}, and you are their first point of contact. They have been told to expect you.

The only thing that matters now is the first message. It does not have to be good.

{{dm_url}}`,
  },

  INTRO_TO_NEW_MEMBER: {
    subject: 'Someone at {{community_name}} wants to say hello',
    body: `Welcome to {{community_name}}.

{{buddy_name}} has offered to be your first point of contact here, the person to ask the things you would feel silly asking anyone else.

They are expecting to hear from you, so there is nothing to apologise for.

{{dm_url}}`,
  },

  REQUIRED_READING: {
    subject: 'Please read: {{article_title}}',
    body: `{{community_name}} has published something it asks every member to read and agree to: {{article_title}}.

You have {{grace_days}} days to read it. After that you will still be able to look around, but you will need to agree before posting, commenting, voting or RSVPing.

{{article_url}}`,
  },
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Every `{{name}}` in a piece of template text. */
export function variablesIn(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]);
}

/**
 * What is wrong with a template an admin is trying to save.
 *
 * Returns reasons rather than throwing, so the editor can show all of them at
 * once instead of making somebody fix one thing per save.
 */
export function validateTemplate(
  kind: BelongingEmailKindName,
  subject: string,
  body: string,
): string[] {
  const problems: string[] = [];

  if (!subject.trim()) problems.push('The subject cannot be empty.');
  if (!body.trim()) problems.push('The message cannot be empty.');

  const used = new Set([...variablesIn(subject), ...variablesIn(body)]);
  const allowed = new Set(AVAILABLE_VARIABLES[kind]);

  for (const required of REQUIRED_VARIABLES[kind]) {
    if (!used.has(required)) {
      problems.push(
        `This email needs {{${required}}} — without it, the button it becomes has nowhere to go.`,
      );
    }
  }

  for (const variable of used) {
    if (!allowed.has(variable)) {
      // Named rather than silently dropped: a variable that renders as
      // nothing looks like a bug in MaybeOS, not a typo in the template.
      problems.push(
        `{{${variable}}} is not available in this email. You can use: ${AVAILABLE_VARIABLES[kind]
          .map((v) => `{{${v}}}`)
          .join(', ')}.`,
      );
    }
  }

  // A link variable inside a sentence would render a button mid-paragraph.
  for (const line of body.split('\n')) {
    const links = variablesIn(line).filter((v) => v in LINK_VARIABLES);
    if (links.length > 0 && line.replace(/\{\{\s*[a-z_]+\s*\}\}/g, '').trim().length > 0) {
      problems.push(`{{${links[0]}}} becomes a button, so it needs a line of its own.`);
      break;
    }
  }

  return problems;
}

/** One line of a paragraph, already substituted. */
function renderLine(
  line: string,
  values: Record<string, string | null | undefined>,
  substituteText: (t: string) => string,
): string {
  const inline = line.trim().match(/^\{\{\s*([a-z_]+)\s*\}\}$/);
  if (inline && inline[1] in LINK_VARIABLES) {
    const href = values[inline[1]];
    // A button with no URL is worse than no button: it looks like the email
    // works and does nothing.
    if (!href) return '';
    return `<a href="${escapeHtml(href)}" style="display:inline-block;margin:4px 8px 4px 0;padding:12px 24px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">${escapeHtml(
      LINK_VARIABLES[inline[1]],
    )}</a>`;
  }
  return substituteText(line);
}

/**
 * Turn a template and its values into a sendable email.
 *
 * Text values are escaped; link values become buttons. A variable with no
 * value renders as nothing rather than as its own name — a member should
 * never receive an email containing `{{buddy_name}}`.
 */
export function renderTemplate(
  template: { subject: string; body: string },
  values: Record<string, string | null | undefined>,
): { subject: string; html: string } {
  const substituteText = (text: string) =>
    text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name: string) => escapeHtml(values[name] ?? ''));

  const paragraphs = template.body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block
        .split('\n')
        .map((line) => renderLine(line, values, substituteText))
        .filter((line) => line.length > 0);
      if (lines.length === 0) return '';
      return `<p style="margin:16px 0;line-height:1.5;">${lines.join('<br />')}</p>`;
    })
    .filter(Boolean);

  return {
    subject: substituteText(template.subject),
    html: paragraphs.join('\n'),
  };
}
