'use client';

import { use } from 'react';
import { DoorList } from '@/components/events/door-list';

/**
 * A host's own event page.
 *
 * Check-in used to live only under `/admin`, which the dashboard layout gates
 * on being an organiser — so the person actually running an event could not
 * reach the list of people coming to it. Hosting is not an admin role.
 *
 * It carries the overview too (EVT-32), because the host and the creator may
 * say who runs the event and this is where they would look. The controls only
 * appear for those two; the API decides the same thing again, and refuses
 * anybody else with a sentence saying who can.
 *
 * Tickets too, now (EVT-41). Charley: "When a member is selling tickets to an
 * event they are hosting or co-hosting, they need visibility into ticket
 * sales, who bought tickets, and an option to refund a person." That used to
 * stay with the co-op's organisers — but the person a buyer writes to is the
 * host, and a host who has to find an organiser to undo their own sale is a
 * host who stops selling tickets.
 */
export default function MemberEventPage(props: {
  params: Promise<{ eventId: string; orgSlug: string }>;
}) {
  const { eventId, orgSlug } = use(props.params);
  return (
    <DoorList
      eventId={eventId}
      backHref={`/member/${orgSlug}/events`}
      overviewFor={orgSlug}
      hostsIfMine
      showTickets
    />
  );
}
