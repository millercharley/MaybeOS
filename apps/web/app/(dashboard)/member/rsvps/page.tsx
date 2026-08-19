import { redirect } from 'next/navigation';

/**
 * RSVPs moved into My Events (Charley, 2026-08-19).
 *
 * A redirect rather than a deletion: this path has been linked from the member
 * dashboard since the dashboard was built, and is in people's history and
 * bookmarks. Breaking it to tidy a route would be the same shape of bug as the
 * dead links this session has spent its time removing.
 */
export default function MyRsvpsPage() {
  redirect('/member/events');
}
