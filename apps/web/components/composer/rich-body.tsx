'use client';

import { MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { renderBodyHtml } from '@/lib/rich-text';
import { parseMention } from '@/lib/mentions';
import { useMemberCard } from '@/contexts/member-card-context';

/**
 * A body somebody wrote, read back (CMN-11).
 *
 * Everywhere that used `dangerouslySetInnerHTML={{ __html: renderBodyHtml(…) }}`
 * can use this instead and get mentions that behave: @ a member opens the
 * member card every name in MaybeOS opens (MEM-18), and # a channel switches
 * to it without leaving the page.
 *
 * The anchors are real anchors, and the click is *upgraded* rather than
 * replaced — modified clicks and middle clicks fall through to the browser,
 * so "open in a new tab" keeps working, and with JavaScript broken the link
 * still goes somewhere true. A mention that only works as an onClick handler
 * is not a link, whatever it looks like.
 */
export function RichBody({
  body,
  className,
  onChannelMention,
}: {
  body: string;
  className?: string;
  /**
   * What to do when somebody clicks a channel mention.
   *
   * The Commons passes a handler that switches channel in place. Everywhere
   * else omits it and the link navigates, because a page that is not the
   * Commons has nothing to switch.
   */
  onChannelMention?: (channelId: string) => void;
}) {
  const { openMember } = useMemberCard();
  const router = useRouter();

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    // Cmd/Ctrl/shift-click and middle-click belong to the browser.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;

    const anchor = (event.target as HTMLElement).closest('a');
    const href = anchor?.getAttribute('href');
    if (!href) return;

    const mention = parseMention(href);
    if (!mention) return;

    if (mention.kind === 'member') {
      event.preventDefault();
      openMember({ userId: mention.id });
      return;
    }

    event.preventDefault();
    if (onChannelMention) onChannelMention(mention.id);
    else router.push(href);
  }

  return (
    <div
      className={className}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: renderBodyHtml(body) }}
    />
  );
}
