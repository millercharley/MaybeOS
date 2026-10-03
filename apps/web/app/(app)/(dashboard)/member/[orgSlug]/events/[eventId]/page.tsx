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
 * No tickets section: who paid, and refunding them, stays with the co-op's
 * organisers.
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
    />
  );
}
