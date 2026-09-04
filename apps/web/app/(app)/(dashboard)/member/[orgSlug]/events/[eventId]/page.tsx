'use client';

import { use } from 'react';
import { DoorList } from '@/components/events/door-list';

/**
 * The host's copy of the door list.
 *
 * Check-in used to live only under `/admin`, which the dashboard layout gates
 * on being an organiser — so the person actually running an event could not
 * reach the list of people coming to it. Hosting is not an admin role.
 *
 * No tickets section: who paid, and refunding them, stays with the co-op's
 * organisers.
 */
export default function MemberEventDoorListPage(props: {
  params: Promise<{ eventId: string; orgSlug: string }>;
}) {
  const { eventId, orgSlug } = use(props.params);
  return <DoorList eventId={eventId} backHref={`/member/${orgSlug}/events`} />;
}
