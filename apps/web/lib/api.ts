import * as Sentry from '@sentry/nextjs';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * Absolute URL for an API path, for links the browser follows rather than
 * fetches — the calendar feed, mainly. Uses the same base as every request, so
 * a link and a fetch can never disagree about where the API is.
 */
export function apiUrl(path: string): string {
  return `${API_BASE}/api${path}`;
}

interface FetchOptions extends RequestInit {
  token?: string;
  orgId?: string;
}

/**
 * Reduce a request path to a stable route label for Sentry messages, tags, and
 * fingerprints. Two jobs, in priority order:
 *
 *  1. Never let a credential through. Every token in this client is passed as
 *     a query parameter (`?token=`), never as a path segment, and the whole
 *     query string is dropped below — so today nothing credential-shaped can
 *     reach a route label. The `OPAQUE_SEGMENT` rule is a backstop in case a
 *     future endpoint puts one in the path.
 *
 *  2. Collapse dynamic segments so one endpoint is one Sentry issue. Getting
 *     this wrong is not cosmetic: an earlier version replaced any segment of
 *     24+ characters with `:token`, which turned `/orgs/by-slug/sunrise` and
 *     `/orgs/by-slug/maybeitsfate-land-cooperative` into *different* labels.
 *     The same endpoint then split into separate issues depending on which
 *     org happened to fail, and a public slug was mislabelled as a credential.
 *     Normalize by known route shape, not by guessing from length.
 */
const UUID_SEGMENT = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// Long, unbroken hex/base64 runs — what an opaque credential looks like. A
// hyphen or a short segment disqualifies it, so real slugs are never matched.
const OPAQUE_SEGMENT = /\/[A-Za-z0-9]{32,}(?=\/|$)/g;

// Exported for its tests (OPS-10). It was unexported and untestable, which is
// how it reached production with a bug only a live Sentry trace revealed.
export function safePath(path: string): string {
  return (
    path
      .split('?')[0]
      .replace(UUID_SEGMENT, '/:id')
      // `by-slug/<slug>` appears for both orgs and events.
      .replace(/\/by-slug\/[^/]+/g, '/by-slug/:slug')
      /**
       * The org position is always `:org`, whether it arrived as an id or a
       * slug.
       *
       * This used to exclude `:id`, so a UUID had already become `/orgs/:id`
       * by the time this ran and kept that label, while a slug became
       * `/orgs/:org`. One endpoint, two labels, two Sentry issues — the exact
       * split this function exists to prevent, just by a different route than
       * the length bug that preceded it. Found by writing its first test.
       */
      .replace(/^\/orgs\/(?!by-slug(?:\/|$))(?!:org(?:\/|$))[^/]+/, '/orgs/:org')
      .replace(OPAQUE_SEGMENT, '/:token')
  );
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, options: FetchOptions = {}): Promise<T> {
    const { token, orgId, ...fetchOptions } = options;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (orgId) {
      headers['X-Org-Id'] = orgId;
    }

    const method = (fetchOptions.method || 'GET').toUpperCase();
    const route = safePath(path);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api${path}`, {
        ...fetchOptions,
        headers,
      });
    } catch (cause) {
      // fetch only rejects when the request never completed: the API is down,
      // DNS failed, CORS blocked it, or the user lost connectivity. The
      // browser's own message for all of these is a bare "Failed to fetch",
      // which is filtered as ambient noise in sentry.shared.ts. Re-wrap it
      // with the route attached so a genuinely unreachable API is reported
      // and grouped, instead of being lost among tab-closed noise.
      const err = new ApiNetworkError(method, route, cause);
      Sentry.captureException(err, (scope) => {
        scope.setLevel('error');
        // ApiNetworkError's message is written for members, so it reads the
        // same for every endpoint and makes a poor issue title on its own.
        // The fingerprint still keeps one issue per endpoint; naming the
        // transaction puts the route back into the issue list, where it can
        // be scanned.
        scope.setTransactionName(`${method} ${route}`);
        scope.setTags({ 'api.method': method, 'api.route': route });
        scope.setFingerprint(['api-unreachable', method, route]);
        return scope;
      });
      throw err;
    }

    Sentry.addBreadcrumb({
      category: 'api',
      type: 'http',
      level: response.ok ? 'info' : 'warning',
      message: `${method} ${route} → ${response.status}`,
      data: { method, route, status: response.status },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      const apiError = new ApiError(response.status, error.message || 'Request failed');

      // Mirrors the API's own policy in GlobalExceptionFilter: 5xx is a
      // defect, 4xx is normal traffic. A wrong password reported as an error
      // would bury the failures that matter.
      if (response.status >= 500) {
        Sentry.captureException(apiError, {
          level: 'error',
          tags: { 'api.method': method, 'api.route': route, 'api.status': String(response.status) },
          fingerprint: ['api-5xx', method, route, String(response.status)],
        });
      }

      throw apiError;
    }

    if (response.status === 204) {
      return undefined as T;
    }

    // A 200 with no body is not a parse failure. Nest sends one whenever a
    // handler returns null or undefined, and `response.json()` throws a
    // SyntaxError on it — which reads to a caller as the request having
    // failed, exactly when nothing went wrong.
    const body = await response.text();
    if (!body) {
      return undefined as T;
    }

    return JSON.parse(body);
  }

  // ── Attachments ──────────────────────────────────
  attachments = {
    /**
     * Files on a **public** event, to anybody (EVT-14).
     *
     * The one attachment call with no token. Every other one is
     * membership-guarded, and the API keeps this narrow: only files hung on
     * the event itself, and only while it is published and public — a comment
     * underneath it is still members-only.
     */
    publicEventFiles: (orgSlug: string, eventSlug: string) =>
      this.request<Attachment[]>(`/public/events/${orgSlug}/${eventSlug}/attachments`),

    /**
     * Ask for somewhere to upload to. The server picks the path — a caller
     * naming its own would be able to write into another co-op's folder.
     */
    uploadUrl: (orgId: string, mimeType: string, token: string) =>
      this.request<{ uploadUrl: string; path: string }>(`/orgs/${orgId}/attachments/upload-url`, {
        method: 'POST',
        body: JSON.stringify({ mimeType }),
        token,
      }),

    /** Tell the API what landed, once storage confirms it did. */
    record: (
      orgId: string,
      data: {
        path: string;
        fileName: string;
        mimeType: string;
        postId?: string;
        commentId?: string;
        eventId?: string;
      },
      token: string,
    ) =>
      this.request<Attachment>(`/orgs/${orgId}/attachments`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    /**
     * Attachments for one post, comment or event.
     *
     * Each `url` is signed and short-lived — the bucket is private, because
     * these hang off members-only posts and private events.
     */
    list: (
      orgId: string,
      owner: { postId?: string; commentId?: string; eventId?: string },
      token: string,
    ) => {
      const query = new URLSearchParams(
        Object.entries(owner).filter(([, v]) => v) as [string, string][],
      ).toString();
      return this.request<Attachment[]>(`/orgs/${orgId}/attachments?${query}`, { token });
    },

    remove: (orgId: string, attachmentId: string, token: string) =>
      this.request<{ removed: boolean }>(`/orgs/${orgId}/attachments/${attachmentId}`, {
        method: 'DELETE',
        token,
      }),
  };

  // ── Calendar ─────────────────────────────────────
  calendar = {
    /**
     * Where to send an admin to connect a room's Google Calendar (SPC-04).
     *
     * The endpoint has existed since SpaceOS was built and nothing in the web
     * app had ever called it, so a room's calendar could not be connected from
     * the product at all.
     */
    connectRoom: (orgId: string, roomId: string, token: string) =>
      this.request<{ url: string }>(`/orgs/${orgId}/rooms/${roomId}/calendar/connect`, {
        token,
      }),
  };

  // ── Auth ─────────────────────────────────────────
  auth = {
    register: (data: { email: string; password: string; name?: string }) =>
      this.request<{ accessToken: string }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    login: (data: { email: string; password: string }) =>
      this.request<{ accessToken: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    magicLink: (email: string) =>
      this.request('/auth/magic-link', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),

    verifyMagicLink: (token: string) =>
      this.request<{ accessToken: string }>(`/auth/magic-link/verify?token=${token}`),

    profile: (token: string) =>
      this.request<UserProfile>('/auth/profile', { token }),

    refresh: (token: string) =>
      this.request<{ accessToken: string }>('/auth/refresh', { method: 'POST', token }),
  };

  auth_password = {
    /** Change your own password (AUTH-03). Requires the current one. */
    change: (data: { currentPassword: string; newPassword: string }, token: string) =>
      this.request<{ changed: boolean }>('/auth/password', {
        method: 'PATCH',
        body: JSON.stringify(data),
        token,
      }),
  };

  auth_profile = {
    update: (data: { name?: string; avatarUrl?: string | null }, token: string) =>
      this.request<UserProfile>('/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify(data),
        token,
      }),
  };

  // ── Orgs ─────────────────────────────────────────
  /**
   * The super-admin console (PLT-01).
   *
   * Outside the org tree on purpose: everything under `/orgs/:orgId` is
   * guarded by membership, and platform administration is not membership.
   */
  platform = {
    summary: (token: string) => this.request<PlatformSummary>('/platform/summary', { token }),

    orgs: (token: string) => this.request<PlatformOrg[]>('/platform/orgs', { token }),

    suspend: (orgId: string, reason: string, token: string) =>
      this.request<unknown>(`/platform/orgs/${orgId}/suspend`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
        token,
      }),

    restore: (orgId: string, token: string) =>
      this.request<unknown>(`/platform/orgs/${orgId}/restore`, { method: 'POST', token }),

    setPlan: (
      orgId: string,
      data: { plan?: string; billingWaived?: boolean; reason?: string },
      token: string,
    ) =>
      this.request<unknown>(`/platform/orgs/${orgId}/plan`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),
  };

  orgs = {
    /** What has been done to this co-op, including by MaybeOS (PLT-01). */
    auditLog: (orgId: string, token: string) =>
      this.request<AuditEntry[]>(`/orgs/${orgId}/audit-log`, { token }),
    /** Where the co-op is (ORG-01). */
    locations: (orgId: string, token: string) =>
      this.request<Location[]>(`/orgs/${orgId}/locations`, { token }),

    addLocation: (orgId: string, data: Partial<Location> & { name: string }, token: string) =>
      this.request<Location>(`/orgs/${orgId}/locations`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    updateLocation: (orgId: string, locationId: string, data: Partial<Location>, token: string) =>
      this.request<Location>(`/orgs/${orgId}/locations/${locationId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        token,
      }),

    /** Refused while a room or event still names it. */
    removeLocation: (orgId: string, locationId: string, token: string) =>
      this.request<{ removed: boolean }>(`/orgs/${orgId}/locations/${locationId}`, {
        method: 'DELETE',
        token,
      }),
    create: (data: CreateOrgData, token: string) =>
      this.request<Org>('/orgs', { method: 'POST', body: JSON.stringify(data), token }),

    get: (orgId: string, token: string) =>
      this.request<Org>(`/orgs/${orgId}`, { token }),

    getBySlug: (slug: string) =>
      this.request<Org>(`/orgs/by-slug/${slug}`),

    update: (
      orgId: string,
      data: Partial<CreateOrgData> & {
        brandColor?: string;
        allowPublicJoin?: boolean;
        /** The co-op's own fee per ticket, in cents (D-013 ticketing). */
        ticketFeeCents?: number;
      },
      token: string,
    ) =>
      this.request<Org>(`/orgs/${orgId}`, { method: 'PATCH', body: JSON.stringify(data), token }),

    listTiers: (orgId: string) =>
      this.request<MembershipTier[]>(`/orgs/${orgId}/tiers`),

    /**
     * Base64 in a JSON body rather than multipart. The API runs as a Netlify
     * Function, where a multipart body arrives base64-encoded from the
     * platform and cannot be exercised locally — see UploadLogoDto.
     */
    uploadLogo: (orgId: string, data: string, mimeType: string, token: string) =>
      this.request<Org>(`/orgs/${orgId}/logo`, {
        method: 'POST',
        body: JSON.stringify({ data, mimeType }),
        token,
      }),

    removeLogo: (orgId: string, token: string) =>
      this.request<Org>(`/orgs/${orgId}/logo`, { method: 'DELETE', token }),
  };

  // ── Members ──────────────────────────────────────
  members = {
    list: (orgId: string, token: string, page = 1, perPage = 25) =>
      this.request<PaginatedResponse<Member>>(
        `/orgs/${orgId}/members?page=${page}&perPage=${perPage}`,
        { token },
      ),

    /**
     * Edit your own entry in a co-op's directory (MEM-09). No userId — the
     * server takes it from the token, so this cannot be aimed at anyone else.
     */
    updateMine: (
      orgId: string,
      data: {
        bio?: string;
        tags?: string[];
        links?: string[];
        headline?: string;
        location?: string;
        emailOptIn?: boolean;
      },
      token: string,
    ) =>
      this.request<{ id: string; bio: string | null; tags: string[]; links: string[] }>(`/orgs/${orgId}/me`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        token,
      }),

    get: (orgId: string, userId: string, token: string) =>
      this.request<Member>(`/orgs/${orgId}/members/${userId}`, { token }),

    /**
     * Change what somebody may do in their co-op (ORG-02).
     *
     * The API refuses to demote the last organiser — a co-op with none cannot
     * reach its own settings, billing or member list.
     */
    updateRole: (orgId: string, userId: string, role: string, token: string) =>
      this.request<Member>(`/orgs/${orgId}/members/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
        token,
      }),

    invite: (
      orgId: string,
      data: { email: string; role?: string; tierId?: string },
      token: string,
    ) =>
      this.request<{ id: string; email: string; status: string }>(`/orgs/${orgId}/members/invite`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    /**
     * Import a chunk of somebody else's export (MEM-06).
     *
     * Chunked by the caller: the API caps a request at 100 rows because it
     * runs in a Lambda with a wall clock, and a co-op with three thousand
     * members should not meet that ceiling as a timeout mid-roster.
     */
    import: (orgId: string, rows: ImportMemberRow[], token: string) =>
      this.request<ImportResult>(`/orgs/${orgId}/members/import`, {
        method: 'POST',
        body: JSON.stringify({ rows }),
        token,
      }),

    /** Copy imported avatars into MaybeOS storage, one batch per call. */
    importAvatars: (orgId: string, body: { after?: string; limit?: number }, token: string) =>
      this.request<AvatarImportResult>(`/orgs/${orgId}/members/import/avatars`, {
        method: 'POST',
        body: JSON.stringify(body),
        token,
      }),

    listInvitations: (orgId: string, token: string) =>
      this.request<Invitation[]>(`/orgs/${orgId}/invitations`, { token }),

    resendInvite: (orgId: string, inviteId: string, token: string) =>
      this.request<{ id: string; email: string; status: string }>(`/orgs/${orgId}/invitations/${inviteId}/resend`, {
        method: 'POST',
        token,
      }),

    // ── Tiers (admin) ──────────────────────────────
    // Distinct from orgs.listTiers, which is the public join-page listing.
    // This one is admin-guarded and additionally returns deactivated tiers and
    // how many members are actively paying for each.
    /** Join an org from its public page. Refused unless the org allows it. */
    joinOrg: (orgId: string, tierId: string | undefined, token: string) =>
      this.request<{ membership: { role: string; subscriptionStatus: string }; alreadyMember: boolean }>(
        `/orgs/${orgId}/join`,
        { method: 'POST', body: JSON.stringify({ tierId }), token },
      ),

    listTiersForAdmin: (orgId: string, token: string) =>
      this.request<AdminTier[]>(`/orgs/${orgId}/tiers/manage`, { token }),

    createTier: (orgId: string, data: TierInput, token: string) =>
      this.request<MembershipTier>(`/orgs/${orgId}/tiers`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    updateTier: (
      orgId: string,
      tierId: string,
      data: Partial<TierInput> & { isActive?: boolean; applyToExistingMembers?: boolean },
      token: string,
    ) =>
      this.request<TierUpdateResult>(`/orgs/${orgId}/tiers/${tierId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        token,
      }),
  };

  invites = {
    get: (inviteToken: string) =>
      this.request<InviteInfo>(`/invites?token=${inviteToken}`),

    /**
     * Returns the org joined and the tier the invitation named (MEM-04). A
     * caller that ignores `tierId` leaves an invited member joined but never
     * asked to pay, which is how invitations and the public join page ended
     * up charging two different prices for the same co-op.
     */
    accept: (inviteToken: string, authToken: string) =>
      this.request<{ status: string; orgId: string; tierId: string | null }>(`/invites/accept?token=${inviteToken}`, {
        method: 'POST',
        token: authToken,
      }),
  };

  // ── Events ───────────────────────────────────────
  events = {
    list: (orgId: string, token: string) =>
      this.request<PaginatedResponse<Event>>(`/orgs/${orgId}/events`, { token }),

    myRsvps: (orgId: string, token: string) =>
      this.request<MyRsvp[]>(`/orgs/${orgId}/events/my-rsvps`, { token }),

    // ── Door list (IMP-10) — organisers only ──────────
    attendees: (orgId: string, eventId: string, token: string) =>
      this.request<DoorList>(`/orgs/${orgId}/events/${eventId}/attendees`, { token }),

    checkIn: (orgId: string, eventId: string, rsvpId: string, token: string) =>
      this.request<{ alreadyCheckedIn: boolean }>(
        `/orgs/${orgId}/events/${eventId}/rsvps/${rsvpId}/check-in`,
        { method: 'POST', token },
      ),

    undoCheckIn: (orgId: string, eventId: string, rsvpId: string, token: string) =>
      this.request(`/orgs/${orgId}/events/${eventId}/rsvps/${rsvpId}/check-in`, {
        method: 'DELETE',
        token,
      }),

    recordWalkIn: (orgId: string, eventId: string, name: string, token: string) =>
      this.request(`/orgs/${orgId}/events/${eventId}/walk-ins`, {
        method: 'POST',
        body: JSON.stringify(name ? { name } : {}),
        token,
      }),

    listPublic: async (orgId: string): Promise<Event[]> => {
      const res = await this.request<PaginatedResponse<Event>>(`/orgs/${orgId}/events/public`);
      return res.data;
    },

    /**
     * The portal listing for a signed-in member: published, uncancelled, and
     * widened from PUBLIC to include MEMBERS_ONLY. `listPublic` is what an
     * anonymous visitor sees, and a new event defaults to MEMBERS_ONLY — so
     * showing every viewer the public list made a co-op's own events invisible
     * to its own members.
     */
    listVisible: async (orgId: string, token: string): Promise<Event[]> => {
      const res = await this.request<PaginatedResponse<Event>>(
        `/orgs/${orgId}/events/visible`,
        { token },
      );
      return res.data;
    },

    /**
     * The same list, addressed by slug.
     *
     * The public pages know a co-op by its slug — that is what sits in the URL
     * — but `/orgs/:orgId/events/public` parses its parameter as a UUID and
     * rejects anything else. Both public event pages passed the slug straight
     * in and got "Validation failed (uuid is expected)", so neither had ever
     * rendered an event. Resolving the slug first is the missing step.
     */
    listPublicBySlug: async (orgSlug: string): Promise<Event[]> => {
      const org = await this.request<Org>(`/orgs/by-slug/${orgSlug}`);
      const res = await this.request<PaginatedResponse<Event>>(
        `/orgs/${org.id}/events/public`,
      );
      return res.data;
    },

    get: (orgId: string, eventId: string, token: string) =>
      this.request<Event>(`/orgs/${orgId}/events/${eventId}`, { token }),

    create: (orgId: string, data: CreateEventData, token: string) =>
      this.request<Event>(`/orgs/${orgId}/events`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    update: (orgId: string, eventId: string, data: Partial<CreateEventData>, token: string) =>
      this.request<Event>(`/orgs/${orgId}/events/${eventId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        token,
      }),

    publish: (orgId: string, eventId: string, token: string) =>
      this.request<Event>(`/orgs/${orgId}/events/${eventId}/publish`, {
        method: 'POST',
        token,
      }),

    cancelEvent: (orgId: string, eventId: string, token: string) =>
      this.request<Event>(`/orgs/${orgId}/events/${eventId}/cancel`, {
        method: 'POST',
        token,
      }),

    /** Events the signed-in member hosts, drafts included (EVT-05). */
    myEvents: (orgId: string, token: string) =>
      this.request<HostedEvent[]>(`/orgs/${orgId}/events/my-events`, { token }),

    /** Turn a confirmed booking into an event (EVT-05). */
    publishFromBooking: (
      orgId: string,
      bookingId: string,
      data: PublishBookingEventData,
      token: string,
    ) =>
      this.request<Event>(`/orgs/${orgId}/bookings/${bookingId}/event`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    /**
     * Who bought a ticket, and whether it has been refunded. Organisers only —
     * this is a list of who paid what.
     */
    listTickets: (orgId: string, eventId: string, token: string) =>
      this.request<TicketSale[]>(`/orgs/${orgId}/events/${eventId}/tickets`, { token }),

    /**
     * Refund one ticket in full, including MaybeOS's fee. Stripe keeps its own
     * processing fee, so this costs the co-op money — the UI says so before
     * asking.
     */
    refundTicket: (orgId: string, ticketId: string, token: string) =>
      this.request<{ refunded: boolean; reason?: string }>(
        `/orgs/${orgId}/tickets/${ticketId}/refund`,
        { method: 'POST', token },
      ),

    /**
     * The post carrying an event's comments, created on first use (EVT-11).
     *
     * Members only. An event page is public; its conversation is not.
     */
    thread: (orgId: string, eventId: string, token: string) =>
      this.request<{ postId: string | null }>(`/orgs/${orgId}/events/${eventId}/thread`, {
        method: 'POST',
        token,
      }),

    /* ─── Paying a member who hosted (EVT-15) ─────────────── */

    hostPayouts: (orgId: string, token: string) =>
      this.request<HostPayoutPreview[]>(`/orgs/${orgId}/host-payouts`, { token }),

    myHostPayouts: (orgId: string, token: string) =>
      this.request<HostPayoutPreview[]>(`/orgs/${orgId}/me/host-payouts`, { token }),

    markPayoutPaid: (orgId: string, eventId: string, note: string, token: string) =>
      this.request<HostPayout>(`/orgs/${orgId}/events/${eventId}/payout/paid`, {
        method: 'POST',
        body: JSON.stringify({ note }),
        token,
      }),

    cancelPayout: (orgId: string, eventId: string, token: string) =>
      this.request<HostPayout>(`/orgs/${orgId}/events/${eventId}/payout/cancel`, {
        method: 'POST',
        token,
      }),

    setHostShare: (orgId: string, shareBps: number, token: string) =>
      this.request<{ hostRevenueShareBps: number }>(`/orgs/${orgId}/host-share`, {
        method: 'PATCH',
        body: JSON.stringify({ shareBps }),
        token,
      }),

    setEventHostShare: (orgId: string, eventId: string, shareBps: number, token: string) =>
      this.request<{ hostRevenueShareBps: number | null }>(
        `/orgs/${orgId}/events/${eventId}/host-share`,
        { method: 'PATCH', body: JSON.stringify({ shareBps }), token },
      ),

    /** Start Stripe checkout for a ticket. No token needed — public events. */
    buyTicket: (
      orgId: string,
      eventId: string,
      data: { successUrl: string; cancelUrl: string; email?: string },
      token?: string,
    ) =>
      this.request<{ url: string }>(`/orgs/${orgId}/events/${eventId}/tickets/checkout`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    /**
     * The response carries the status the API decided (EVT-02). A full event
     * with a waitlist answers WAITLISTED rather than refusing, and a caller
     * that discards this tells someone they have a place when they do not.
     */
    rsvp: (orgId: string, eventId: string, token: string) =>
      this.request<{ id: string; status: 'CONFIRMED' | 'WAITLISTED' }>(
        `/orgs/${orgId}/events/${eventId}/rsvp`,
        { method: 'POST', token },
      ),

    publicFeedJson: (orgId: string) =>
      this.request<Event[]>(`/orgs/${orgId}/events/feed.json`),

    /**
     * The public event page. Path corrected: `/orgs/:slug/events/by-slug/:slug`
     * is not a route the API has ever served — the real one is below.
     */
    getPublicBySlug: (orgSlug: string, eventSlug: string) =>
      this.request<Event>(`/public/events/${orgSlug}/${eventSlug}`),

    guestRsvp: (orgId: string, eventId: string, data: { name: string; email: string }) =>
      this.request(`/orgs/${orgId}/events/${eventId}/guest-rsvp`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  };

  // ── Rooms & Bookings ────────────────────────────
  rooms = {
    list: (orgId: string, token: string) =>
      this.request<Room[]>(`/orgs/${orgId}/rooms`, { token }),

    get: (orgId: string, roomId: string, token: string) =>
      this.request<Room>(`/orgs/${orgId}/rooms/${roomId}`, { token }),

    update: (orgId: string, roomId: string, data: Partial<CreateRoomData>, token: string) =>
      this.request<Room>(`/orgs/${orgId}/rooms/${roomId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        token,
      }),

    create: (orgId: string, data: CreateRoomData, token: string) =>
      this.request<Room>(`/orgs/${orgId}/rooms`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    /**
     * Book a room. A room that charges for hire (SPC-06) answers with a
     * `checkoutUrl` and a booking that is only a hold until it is paid for —
     * a caller that ignores the URL leaves the member holding a slot they
     * were never given the chance to pay for, and it lapses in 30 minutes.
     */
    createBooking: (orgId: string, roomId: string, data: CreateBookingData, token: string) =>
      this.request<Booking & { checkoutUrl?: string }>(`/orgs/${orgId}/rooms/${roomId}/bookings`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    /**
     * The room's bookings over a date range. The range is required — this used
     * to omit it and could never have worked: the API answered 500 (now 400).
     * No page calls this yet.
     */
    listBookings: (
      orgId: string,
      roomId: string,
      range: { from: string; to: string },
      token: string,
    ) =>
      this.request<Booking[]>(
        `/orgs/${orgId}/rooms/${roomId}/bookings` +
          `?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
        { token },
      ),

    myBookings: (orgId: string, token: string) =>
      this.request<Booking[]>(`/orgs/${orgId}/my-bookings`, { token }),

    reschedule: (
      orgId: string,
      bookingId: string,
      data: { startTime: string; endTime: string },
      token: string,
    ) =>
      this.request<Booking>(`/orgs/${orgId}/bookings/${bookingId}/reschedule`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        token,
      }),

    cancelBooking: (orgId: string, bookingId: string, token: string) =>
      this.request<Booking>(`/orgs/${orgId}/bookings/${bookingId}/cancel`, {
        method: 'POST',
        token,
      }),

    approveBooking: (orgId: string, roomId: string, bookingId: string, token: string) =>
      this.request<Booking>(`/orgs/${orgId}/rooms/${roomId}/bookings/${bookingId}/approve`, {
        method: 'POST',
        token,
      }),

    rejectBooking: (orgId: string, roomId: string, bookingId: string, token: string) =>
      this.request<Booking>(`/orgs/${orgId}/rooms/${roomId}/bookings/${bookingId}/reject`, {
        method: 'POST',
        token,
      }),
  };

  // ── Commons ──────────────────────────────────────
  commons = {
    listChannels: (orgId: string, token: string) =>
      this.request<Channel[]>(`/orgs/${orgId}/channels`, { token }),

    createChannel: (orgId: string, data: { name: string; description?: string; isPublic?: boolean }, token: string) =>
      this.request<Channel>(`/orgs/${orgId}/channels`, { method: 'POST', body: JSON.stringify(data), token }),

    pinChannel: (orgId: string, channelId: string, pinned: boolean, token: string) =>
      this.request<Channel>(`/orgs/${orgId}/channels/${channelId}/pin`, { method: pinned ? 'POST' : 'DELETE', token }),

    listPosts: (orgId: string, channelId: string, token: string) =>
      this.request<PaginatedResponse<Post>>(`/orgs/${orgId}/channels/${channelId}/posts`, { token }),

    getPost: (orgId: string, postId: string, token: string) =>
      this.request<Post>(`/orgs/${orgId}/posts/${postId}`, { token }),

    createPost: (orgId: string, channelId: string, data: { title?: string; body: string }, token: string) =>
      this.request<Post>(`/orgs/${orgId}/channels/${channelId}/posts`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    addComment: (orgId: string, postId: string, data: { body: string; parentId?: string }, token: string) =>
      this.request<Comment>(`/orgs/${orgId}/posts/${postId}/comments`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    addReaction: (orgId: string, postId: string, emoji: string, token: string) =>
      this.request(`/orgs/${orgId}/posts/${postId}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
        token,
      }),

    removeReaction: (orgId: string, postId: string, emoji: string, token: string) =>
      this.request(`/orgs/${orgId}/posts/${postId}/reactions/${encodeURIComponent(emoji)}`, {
        method: 'DELETE',
        token,
      }),

    getProposal: (orgId: string, proposalId: string, token: string) =>
      this.request<Proposal>(`/orgs/${orgId}/proposals/${proposalId}`, { token }),

    /**
     * Raise a proposal (CMN-10).
     *
     * Any member may raise one; it starts as a DRAFT and an organiser opens it
     * for voting. That split is the co-op's, not an accident of the API — the
     * open and close routes are ADMIN-only — so the UI says which state a
     * proposal is in rather than leaving somebody wondering why nobody voted.
     */
    createProposal: (
      orgId: string,
      channelId: string,
      data: { title: string; body: string; quorum?: number; closesAt?: string },
      token: string,
    ) =>
      this.request<Proposal>(`/orgs/${orgId}/channels/${channelId}/proposals`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    /** Open a raised proposal for voting. Organisers only. */
    openProposal: (orgId: string, proposalId: string, token: string) =>
      this.request<Proposal>(`/orgs/${orgId}/proposals/${proposalId}/open`, {
        method: 'POST',
        token,
      }),

    /**
     * Close voting and tally. Organisers only.
     *
     * The outcome is computed rather than chosen: quorum, then majority. What
     * comes back is PASSED or FAILED, which the co-op reads as adopted or
     * lacked support.
     */
    closeProposal: (orgId: string, proposalId: string, token: string) =>
      this.request<Proposal>(`/orgs/${orgId}/proposals/${proposalId}/close`, {
        method: 'POST',
        token,
      }),

    listProposals: (orgId: string, token: string) =>
      this.request<Proposal[]>(`/orgs/${orgId}/proposals`, { token }),

    vote: (orgId: string, proposalId: string, choice: string, token: string) =>
      this.request(`/orgs/${orgId}/proposals/${proposalId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ choice }),
        token,
      }),

    // ── Direct Messages ──
    listConversations: (orgId: string, token: string) =>
      this.request<DmConversation[]>(`/orgs/${orgId}/dms`, { token }),

    getConversation: (orgId: string, otherUserId: string, token: string) =>
      this.request<DirectMessage[]>(`/orgs/${orgId}/dms/${otherUserId}`, { token }),

    sendMessage: (orgId: string, otherUserId: string, body: string, token: string) =>
      this.request<DirectMessage>(`/orgs/${orgId}/dms/${otherUserId}`, {
        method: 'POST',
        body: JSON.stringify({ body }),
        token,
      }),

    markConversationRead: (orgId: string, otherUserId: string, token: string) =>
      this.request(`/orgs/${orgId}/dms/${otherUserId}/read`, { method: 'POST', token }),

    // ── Collections (wiki) ──
    listCollections: (orgId: string, token: string) =>
      this.request<Collection[]>(`/orgs/${orgId}/collections`, { token }),

    createCollection: (orgId: string, data: { name: string; emoji?: string; description?: string; sortOrder?: number }, token: string) =>
      this.request<Collection>(`/orgs/${orgId}/collections`, { method: 'POST', body: JSON.stringify(data), token }),

    deleteCollection: (orgId: string, collectionId: string, token: string) =>
      this.request(`/orgs/${orgId}/collections/${collectionId}`, { method: 'DELETE', token }),

    getPage: (orgId: string, pageId: string, token: string) =>
      this.request<CollectionPage>(`/orgs/${orgId}/pages/${pageId}`, { token }),

    createPage: (orgId: string, collectionId: string, data: { title: string; body: string; sortOrder?: number }, token: string) =>
      this.request<CollectionPage>(`/orgs/${orgId}/collections/${collectionId}/pages`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    updatePage: (orgId: string, pageId: string, data: { title?: string; body?: string; sortOrder?: number }, token: string) =>
      this.request<CollectionPage>(`/orgs/${orgId}/pages/${pageId}`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    deletePage: (orgId: string, pageId: string, token: string) =>
      this.request(`/orgs/${orgId}/pages/${pageId}`, { method: 'DELETE', token }),

    // ── Search (⌘K) ──
    search: (orgId: string, q: string, token: string) =>
      this.request<SearchResults>(`/orgs/${orgId}/search?q=${encodeURIComponent(q)}`, { token }),
  };

  // ── Impact ───────────────────────────────────────
  impact = {
    listSurveys: (orgId: string, token: string) =>
      this.request<Survey[]>(`/orgs/${orgId}/surveys`, { token }),

    getSurvey: (orgId: string, surveyId: string, token: string) =>
      this.request<Survey>(`/orgs/${orgId}/surveys/${surveyId}`, { token }),

    submitResponse: (orgId: string, surveyId: string, data: SubmitSurveyData, token: string) =>
      this.request(`/orgs/${orgId}/surveys/${surveyId}/respond`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    dashboard: (orgId: string, token: string) =>
      this.request<ImpactDashboardData>(`/orgs/${orgId}/impact/dashboard`, { token }),

    // ── Touchpoints (IMP-15) ──
    /**
     * The one question to ask at this moment, or null. Null is the ordinary
     * answer and the caller renders nothing: the fatigue budget allows one
     * question per member per 30 days across every touchpoint (D-021).
     */
    /* ─── The year-end report (IMP-22) ────────────────────── */

    listReports: (orgId: string, token: string) =>
      this.request<ReportSummary[]>(`/orgs/${orgId}/impact/reports`, { token }),

    getReport: (orgId: string, reportId: string, token: string) =>
      this.request<ImpactReport>(`/orgs/${orgId}/impact/reports/${reportId}`, { token }),

    generateReport: (
      orgId: string,
      data: {
        title?: string;
        periodStart?: string;
        periodEnd?: string;
        tier?: 'BASIC' | 'WRITTEN';
      },
      token: string,
    ) =>
      this.request<ImpactReport>(`/orgs/${orgId}/impact/reports`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    updateReportBlock: (orgId: string, reportId: string, blockId: string, body: string, token: string) =>
      this.request<ReportBlock>(
        `/orgs/${orgId}/impact/reports/${reportId}/blocks/${blockId}`,
        { method: 'PATCH', body: JSON.stringify({ body }), token },
      ),

    publishReport: (orgId: string, reportId: string, token: string) =>
      this.request<{ slug: string; status: string; publishedAt: string | null }>(
        `/orgs/${orgId}/impact/reports/${reportId}/publish`,
        { method: 'POST', token },
      ),

    /** Queues the rewriting; it does not wait for it (IMP-23). */
    composeReport: (orgId: string, reportId: string, token: string) =>
      this.request<{ composeStatus: ComposeStatus }>(
        `/orgs/${orgId}/impact/reports/${reportId}/compose`,
        { method: 'POST', token },
      ),

    unpublishReport: (orgId: string, reportId: string, token: string) =>
      this.request<{ status: string }>(
        `/orgs/${orgId}/impact/reports/${reportId}/unpublish`,
        { method: 'POST', token },
      ),

    /* ─── Paying for the written report (IMP-23) ───────────── */

    reportPurchaseStatus: (orgId: string, reportId: string, token: string) =>
      this.request<ReportPurchaseStatus>(
        `/orgs/${orgId}/impact/reports/${reportId}/purchase`,
        { token },
      ),

    buyReport: (
      orgId: string,
      reportId: string,
      urls: { successUrl: string; cancelUrl: string },
      token: string,
    ) =>
      this.request<{ url: string; purchaseId: string }>(
        `/orgs/${orgId}/impact/reports/${reportId}/purchase`,
        { method: 'POST', body: JSON.stringify(urls), token },
      ),

    /** A published report, to anybody. The one unauthenticated impact call. */
    publicReport: (orgSlug: string, reportSlug: string) =>
      this.request<PublicReport>(`/public/reports/${orgSlug}/${reportSlug}`),

    /** Mission, goals, indicators, and whether the plan is agreed (IMP-21). */
    plan: (orgId: string, token: string) =>
      this.request<MeasurementPlan>(`/orgs/${orgId}/impact/plan`, { token }),

    setMission: (orgId: string, mission: string, token: string) =>
      this.request<{ mission: string | null }>(`/orgs/${orgId}/impact/plan/mission`, {
        method: 'PATCH',
        body: JSON.stringify({ mission }),
        token,
      }),

    createGoal: (orgId: string, data: { title: string; description?: string }, token: string) =>
      this.request<{ goal: Goal; suggested: DraftedIndicator[] }>(`/orgs/${orgId}/impact/goals`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    archiveGoal: (orgId: string, goalId: string, token: string) =>
      this.request<{ archived: boolean }>(`/orgs/${orgId}/impact/goals/${goalId}`, {
        method: 'DELETE',
        token,
      }),

    addIndicator: (
      orgId: string,
      goalId: string,
      data: { category: string; label: string },
      token: string,
    ) =>
      this.request<Indicator>(`/orgs/${orgId}/impact/goals/${goalId}/indicators`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    removeIndicator: (orgId: string, goalId: string, indicatorId: string, token: string) =>
      this.request<{ removed: boolean }>(
        `/orgs/${orgId}/impact/goals/${goalId}/indicators/${indicatorId}`,
        { method: 'DELETE', token },
      ),

    approvePlan: (orgId: string, token: string) =>
      this.request<{ status: string; approvedAt: string | null }>(
        `/orgs/${orgId}/impact/plan/approve`,
        { method: 'POST', token },
      ),

    signalsByGoal: (orgId: string, token: string) =>
      this.request<SignalsByGoal>(`/orgs/${orgId}/impact/signals/by-goal`, { token }),

    /** What the co-op learned, small cells suppressed (IMP-20). */
    signals: (orgId: string, token: string) =>
      this.request<Signals>(`/orgs/${orgId}/impact/signals`, { token }),

    /** A member's own answers, and the co-op's totals (IMP-20). */
    myImpact: (orgId: string, token: string) =>
      this.request<MyImpact>(`/orgs/${orgId}/me/impact`, { token }),

    /** What this co-op asks, and whether it is asking it (IMP-18). */
    measurement: (orgId: string, token: string) =>
      this.request<MeasurementStatus>(`/orgs/${orgId}/impact/measurement`, { token }),

    startMeasuring: (orgId: string, token: string) =>
      this.request<{ surveyId: string; windowId: string; window: string }>(
        `/orgs/${orgId}/impact/measurement/start`,
        { method: 'POST', token },
      ),

    stopMeasuring: (orgId: string, token: string) =>
      this.request<{ collecting: boolean }>(`/orgs/${orgId}/impact/measurement/stop`, {
        method: 'POST',
        token,
      }),

    nextAsk: (orgId: string, touchpoint: string, token: string) =>
      this.request<{ question: TouchpointAsk | null }>(
        `/orgs/${orgId}/impact/ask?touchpoint=${encodeURIComponent(touchpoint)}`,
        { token },
      ),

    answerAsk: (orgId: string, questionId: string, value: string | number, token: string) =>
      this.request(`/orgs/${orgId}/impact/ask/${questionId}/answer`, {
        method: 'POST',
        body: JSON.stringify({ value }),
        token,
      }),

    dismissAsk: (orgId: string, token: string) =>
      this.request(`/orgs/${orgId}/impact/ask/dismiss`, { method: 'POST', token }),

    // ── Expenses (IMP-16) ──
    listExpenses: (orgId: string, token: string) =>
      this.request<Expense[]>(`/orgs/${orgId}/impact/expenses`, { token }),

    expenseSummary: (orgId: string, token: string) =>
      this.request<ExpenseSummary>(`/orgs/${orgId}/impact/expenses/summary`, { token }),

    createExpense: (orgId: string, data: CreateExpenseData, token: string) =>
      this.request<Expense>(`/orgs/${orgId}/impact/expenses`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    deleteExpense: (orgId: string, expenseId: string, token: string) =>
      this.request(`/orgs/${orgId}/impact/expenses/${expenseId}`, {
        method: 'DELETE',
        token,
      }),

    // ── The member's own demographic profile (IMP-17) ──
    myDemographics: (orgId: string, token: string) =>
      this.request<MyDemographics>(`/orgs/${orgId}/me/demographics`, { token }),

    saveMyDemographics: (
      orgId: string,
      answers: Record<string, string>,
      token: string,
    ) =>
      this.request<{ answers: Record<string, string> }>(
        `/orgs/${orgId}/me/demographics`,
        { method: 'PUT', body: JSON.stringify({ answers }), token },
      ),

    deleteMyDemographics: (orgId: string, token: string) =>
      this.request(`/orgs/${orgId}/me/demographics`, { method: 'DELETE', token }),
  };

  // ── Belonging Support: the Buddy System and the Knowledge Center (BEL) ──
  belonging = {
    settings: (orgId: string, token: string) =>
      this.request<BelongingSettings>(`/orgs/${orgId}/belonging/settings`, { token }),

    updateSettings: (orgId: string, data: Partial<BelongingSettings>, token: string) =>
      this.request<BelongingSettings>(`/orgs/${orgId}/belonging/settings`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        token,
      }),

    emailTemplates: (orgId: string, token: string) =>
      this.request<BelongingEmailTemplate[]>(`/orgs/${orgId}/belonging/emails`, { token }),

    saveEmailTemplate: (orgId: string, kind: string, data: { subject: string; body: string }, token: string) =>
      this.request<unknown>(`/orgs/${orgId}/belonging/emails/${kind}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        token,
      }),

    resetEmailTemplate: (orgId: string, kind: string, token: string) =>
      this.request<unknown>(`/orgs/${orgId}/belonging/emails/${kind}`, { method: 'DELETE', token }),

    /* ── Buddy ── */

    pairings: (orgId: string, token: string) =>
      this.request<BuddyPairingRow[]>(`/orgs/${orgId}/belonging/buddy/pairings`, { token }),

    invitations: (orgId: string, token: string) =>
      this.request<BuddyInvitationRow[]>(`/orgs/${orgId}/belonging/buddy/invitations`, { token }),

    buddyMembers: (orgId: string, token: string) =>
      this.request<BuddyMemberRow[]>(`/orgs/${orgId}/belonging/buddy/members`, { token }),

    myBuddyState: (orgId: string, token: string) =>
      this.request<MyBuddyState>(`/orgs/${orgId}/belonging/buddy/me`, { token }),

    setBuddyOptOut: (orgId: string, optedOut: boolean, token: string) =>
      this.request<unknown>(`/orgs/${orgId}/belonging/buddy/me/opt-out`, {
        method: 'PATCH',
        body: JSON.stringify({ optedOut }),
        token,
      }),

    reassignPairing: (orgId: string, pairingId: string, buddyMemberId: string, token: string) =>
      this.request<unknown>(`/orgs/${orgId}/belonging/buddy/pairings/${pairingId}/reassign`, {
        method: 'POST',
        body: JSON.stringify({ buddyMemberId }),
        token,
      }),

    closePairing: (orgId: string, pairingId: string, reason: string | undefined, token: string) =>
      this.request<unknown>(`/orgs/${orgId}/belonging/buddy/pairings/${pairingId}/close`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
        token,
      }),

    searchAgain: (orgId: string, pairingId: string, token: string) =>
      this.request<unknown>(`/orgs/${orgId}/belonging/buddy/pairings/${pairingId}/search`, {
        method: 'POST',
        token,
      }),

    suggestions: (orgId: string, token: string) =>
      this.request<BuddySuggestion[]>(`/orgs/${orgId}/belonging/buddy/suggestions`, { token }),

    createSuggestion: (orgId: string, body: string, token: string) =>
      this.request<BuddySuggestion>(`/orgs/${orgId}/belonging/buddy/suggestions`, {
        method: 'POST',
        body: JSON.stringify({ body }),
        token,
      }),

    updateSuggestion: (orgId: string, id: string, data: Partial<BuddySuggestion>, token: string) =>
      this.request<BuddySuggestion>(`/orgs/${orgId}/belonging/buddy/suggestions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        token,
      }),

    deleteSuggestion: (orgId: string, id: string, token: string) =>
      this.request<unknown>(`/orgs/${orgId}/belonging/buddy/suggestions/${id}`, { method: 'DELETE', token }),

    /** Prompts for the buddy in one conversation. Empty for anybody else. */
    threadSuggestions: (orgId: string, otherUserId: string, token: string) =>
      this.request<{ pairingId: string | null; suggestions: Array<{ id: string; body: string }> }>(
        `/orgs/${orgId}/belonging/buddy/thread/${otherUserId}/suggestions`,
        { token },
      ),

    dismissSuggestion: (orgId: string, id: string, token: string) =>
      this.request<unknown>(`/orgs/${orgId}/belonging/buddy/suggestions/${id}/dismiss`, {
        method: 'POST',
        token,
      }),

    /* ── Knowledge Center ── */

    articles: (orgId: string, token: string) =>
      this.request<ArticleSummary[]>(`/orgs/${orgId}/welcome/articles`, { token }),

    article: (orgId: string, idOrSlug: string, token: string) =>
      this.request<Article>(`/orgs/${orgId}/welcome/articles/${idOrSlug}`, { token }),

    outstandingReading: (orgId: string, token: string) =>
      this.request<OutstandingReading>(`/orgs/${orgId}/welcome/outstanding`, { token }),

    createArticle: (
      orgId: string,
      data: { title: string; body: string; coverImagePath?: string; requiresAcknowledgment?: boolean },
      token: string,
    ) =>
      this.request<Article>(`/orgs/${orgId}/welcome/articles`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    updateArticle: (
      orgId: string,
      articleId: string,
      data: {
        title?: string;
        body?: string;
        coverImagePath?: string | null;
        requiresAcknowledgment?: boolean;
        material?: boolean;
      },
      token: string,
    ) =>
      this.request<Article>(`/orgs/${orgId}/welcome/articles/${articleId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        token,
      }),

    publishArticle: (orgId: string, articleId: string, token: string) =>
      this.request<Article>(`/orgs/${orgId}/welcome/articles/${articleId}/publish`, { method: 'POST', token }),

    unpublishArticle: (orgId: string, articleId: string, token: string) =>
      this.request<Article>(`/orgs/${orgId}/welcome/articles/${articleId}/unpublish`, { method: 'POST', token }),

    reorderArticles: (orgId: string, orderedIds: string[], token: string) =>
      this.request<unknown>(`/orgs/${orgId}/welcome/articles/reorder`, {
        method: 'POST',
        body: JSON.stringify({ orderedIds }),
        token,
      }),

    deleteArticle: (orgId: string, articleId: string, token: string) =>
      this.request<unknown>(`/orgs/${orgId}/welcome/articles/${articleId}`, { method: 'DELETE', token }),

    uploadArticleCover: (
      orgId: string,
      articleId: string,
      data: { data: string; mimeType: string },
      token: string,
    ) =>
      this.request<Article>(`/orgs/${orgId}/welcome/articles/${articleId}/cover`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    removeArticleCover: (orgId: string, articleId: string, token: string) =>
      this.request<unknown>(`/orgs/${orgId}/welcome/articles/${articleId}/cover`, {
        method: 'DELETE',
        token,
      }),

    acknowledgeArticle: (orgId: string, articleId: string, token: string) =>
      this.request<unknown>(`/orgs/${orgId}/welcome/articles/${articleId}/acknowledge`, {
        method: 'POST',
        token,
      }),

    likeArticle: (orgId: string, articleId: string, token: string) =>
      this.request<{ liked: boolean }>(`/orgs/${orgId}/welcome/articles/${articleId}/like`, {
        method: 'POST',
        token,
      }),

    commentOnArticle: (orgId: string, articleId: string, body: string, token: string) =>
      this.request<ArticleComment>(`/orgs/${orgId}/welcome/articles/${articleId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
        token,
      }),

    deleteArticleComment: (orgId: string, commentId: string, token: string) =>
      this.request<unknown>(`/orgs/${orgId}/welcome/comments/${commentId}`, { method: 'DELETE', token }),

    compliance: (orgId: string, articleId: string, token: string) =>
      this.request<ArticleCompliance>(`/orgs/${orgId}/welcome/articles/${articleId}/compliance`, { token }),

    remind: (orgId: string, articleId: string, token: string) =>
      this.request<{ reminded: number }>(`/orgs/${orgId}/welcome/articles/${articleId}/remind`, {
        method: 'POST',
        token,
      }),
  };

  // ── Stripe Connect: the co-op's own payouts (D-013) ──
  connect = {
    status: (orgId: string, token: string) =>
      this.request<ConnectStatus>(`/orgs/${orgId}/connect/status`, { token }),

    startOnboarding: (
      orgId: string,
      data: { returnUrl: string; refreshUrl: string },
      token: string,
    ) =>
      this.request<{ url: string }>(`/orgs/${orgId}/connect/onboarding`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    /**
     * Connect a Stripe account the co-op already has (PAY-05), rather than
     * being made a new one. Returns Stripe's authorize URL to redirect to.
     */
    startOAuth: (orgId: string, token: string) =>
      this.request<{ url: string }>(`/orgs/${orgId}/connect/oauth/start`, {
        method: 'POST',
        token,
      }),

    refundTicket: (orgId: string, ticketId: string, token: string) =>
      this.request<{ refunded: boolean; reason?: string }>(
        `/orgs/${orgId}/tickets/${ticketId}/refund`,
        { method: 'POST', token },
      ),
  };

  // ── Stripe ───────────────────────────────────────
  stripe = {
    // amountCents is required for pay-what-you-can tiers and rejected for
    // fixed-price ones. The server validates it against the tier minimum and
    // Stripe's 50c floor, so the UI's own validation is a convenience, not the
    // control.
    createCheckout: (
      orgId: string,
      data: { tierId: string; successUrl: string; cancelUrl: string; amountCents?: number },
      token: string,
    ) =>
      this.request<{ url: string }>(`/orgs/${orgId}/checkout`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    createPortal: (orgId: string, data: { returnUrl: string }, token: string) =>
      this.request<{ url: string }>(`/orgs/${orgId}/billing-portal`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),
  };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * The request never reached the API: it is down, unreachable, or blocked.
 * Distinct from ApiError, which means the API answered and said no.
 *
 * The message is deliberately written for a member reading it on screen, not
 * for a developer reading a log. Nine call sites across the app render
 * `err.message` directly into the UI, so anything technical here — a route, a
 * method, an internal hostname — is text a co-op member ends up staring at.
 *
 * No diagnostic detail is lost: `method` and `route` are carried as properties
 * and are attached to every Sentry report as tags and as the fingerprint, so
 * issues still group per endpoint.
 *
 * One constraint on any future rewording: it must not contain the browser's
 * native failure strings ("Failed to fetch", "Load failed", …), which
 * sentry.shared.ts filters as ambient noise. See D-011 — the whole point of
 * this class is to be reportable when those are not.
 */
export class ApiNetworkError extends Error {
  constructor(
    public method: string,
    public route: string,
    public cause?: unknown,
  ) {
    super("Can't reach MaybeOS right now. Check your connection and try again.");
    this.name = 'ApiNetworkError';
  }
}

export const api = new ApiClient(API_BASE);

// ── Type definitions ─────────────────────────────────

export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string | null;
  globalRole: string;
  emailVerified?: boolean;
  createdAt?: string;
  /**
   * Membership rows, each with its organization nested — which is what
   * /auth/profile returns. This previously declared flat `orgName` and
   * `orgSlug` fields the API has never sent; nothing read them, so it caused
   * no bug, but it is the same shape of fiction that made every proposal
   * card render 0% (OPS-05).
   */
  orgs: Array<{
    orgId: string;
    role: string;
    tierId?: string | null;
    /** Non-null in the database with a NONE default, so always present. */
    subscriptionStatus: string;
    memberSince?: string;
    org?: { id: string; name: string; slug: string; logoUrl?: string | null };
  }>;
}

export interface TicketSale {
  id: string;
  buyerEmail: string;
  buyerName?: string | null;
  /** What the buyer paid, all in. */
  amountCents: number;
  /** How it split, recorded at purchase — plans and fees change (D-013). */
  platformFeeCents: number;
  orgFeeCents: number;
  currency: string;
  refundedAt?: string | null;
  createdAt: string;
}

export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  /** Signed and short-lived. Null when storage is not configured. */
  url?: string | null;
}

export interface Org {
  id: string;
  name: string;
  slug: string;
  description?: string;
  mission?: string;
  logoUrl?: string;
  brandColor: string;
  timezone: string;
  /**
   * Whether a stranger can join from the public page. Off by default: a
   * housing co-op or members' club must not be joinable by anyone with a
   * card (D-020). The API refuses the self-join endpoint when this is false,
   * so the public page must not offer it either.
   */
  allowPublicJoin: boolean;
  /**
   * Only `GET /orgs/by-slug/:slug` includes these — the public org page's
   * single call. `GET /orgs/:orgId` returns the bare row, so anything reading
   * them off an org fetched by id gets undefined.
   */
  locations?: Location[];
  tiers?: MembershipTier[];
  /** MaybeOS plan, which sets the per-transaction ticket fee (D-013). */
  plan?: 'FREE' | 'PLUS' | 'UNLIMITED';
  /** A fee the co-op adds to its own ticket sales, in cents. */
  ticketFeeCents?: number;
  /** Whether Stripe onboarding is finished and tickets can actually sell. */
  stripeChargesEnabled?: boolean;
}

export interface CreateOrgData {
  name: string;
  slug: string;
  description?: string;
  mission?: string;
  timezone?: string;
}

export interface PlatformOrg {
  id: string;
  name: string;
  slug: string;
  url: string;
  customDomain: string | null;
  plan: string;
  planStatus: string | null;
  billingWaived: boolean;
  billingWaivedReason: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  createdAt: string;
  memberCount: number;
  eventCount: number;
  roomCount: number;
  transactionFeeCents: number;
  /** One organiser to write to — never the member list. */
  contact: { name: string | null; email: string } | null;
  hasNoAdmin: boolean;
  /** Started Stripe onboarding and never finished it. */
  stripeHalfConnected: boolean;
}

export interface PlatformSummary {
  /** A rejected storage key is MaybeOS's problem and silent everywhere else. */
  storage?: {
    configured: boolean;
    reachable: boolean;
    httpStatus?: number;
    buckets?: string[];
  };
  orgs: number;
  suspended: number;
  billingWaived: number;
  canTakePayments: number;
  memberships: number;
  byPlan: Record<string, number>;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; name: string | null; email: string } | null;
}

export interface Location {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  /** A location's own timezone, which is the point of having more than one. */
  timezone?: string;
  isDefault?: boolean;
  /** What still names it — deleting is refused while either is above zero. */
  roomCount?: number;
  eventCount?: number;
}

export interface TierInput {
  name: string;
  description?: string;
  priceMonthly: number;
  isPayWhatYouCan?: boolean;
  minPrice?: number;
  benefits?: string[];
}

export interface AdminTier extends MembershipTier {
  isActive: boolean;
  sortOrder: number;
  stripePriceIdMonthly?: string | null;
  /** Members currently paying for this tier (ACTIVE, TRIALING or PAST_DUE). */
  activeSubscribers: number;
}

/** What actually happened to people's money on a price change. */
export interface TierUpdateResult extends MembershipTier {
  repriced: boolean;
  migratedSubscribers: number;
  grandfathered: boolean;
}

export interface MembershipTier {
  id: string;
  name: string;
  description?: string;
  priceMonthly: number;
  priceYearly?: number;
  isPayWhatYouCan: boolean;
  /** Floor for a pay-what-you-can tier, in cents. Server-enforced. */
  minPrice?: number;
  benefits: string[];
}

/** One row of an export, in MaybeOS's own field names (MEM-06). */
export interface ImportMemberRow {
  email: string;
  name?: string;
  joinedAt?: string;
  headline?: string;
  location?: string;
  bio?: string;
  tags?: string[];
  links?: string[];
  avatarUrl?: string;
  emailOptIn?: boolean;
}

export interface ImportResult {
  created: number;
  alreadyMembers: number;
  linkedExistingUsers: number;
  avatarsPending: number;
  errors: Array<{ email: string; reason: string }>;
}

export interface AvatarImportResult {
  imported: number;
  failed: number;
  remaining: number;
  lastId: string | null;
  done: boolean;
}

export interface HostPayout {
  id: string;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  amountCents: number;
  grossCents: number;
  shareBps: number;
  paidAt: string | null;
  note: string | null;
}

/** What one event owes its host, recomputed until it is marked paid. */
export interface HostPayoutPreview {
  eventId: string;
  title: string;
  endTime: string;
  host: { id: string; name?: string } | null;
  hasEnded: boolean;
  /** Ticket face value — the fees were added on top and were never the host's. */
  grossCents: number;
  shareBps: number;
  amountCents: number;
  ticketCount: number;
  refundedCount: number;
  payout: HostPayout | null;
}

export interface Member {
  id: string;
  /**
   * `email` reaches organisers (ADMIN, STAFF) and the member themselves —
   * nobody else. Members must not see each other's contact information, so
   * the API omits it for everyone else and this is optional to match. Any
   * member-facing screen reading it will get undefined.
   */
  user: { id: string; email?: string; name?: string; avatarUrl?: string };
  role: string;
  tier?: MembershipTier;
  /** Another member's billing state is not their business — organisers only. */
  subscriptionStatus?: string;
  memberSince: string;
  tags: string[];
  /**
   * What this member wrote about themselves for *this* co-op. Per-membership,
   * not per-user: orgs are firewalled, so a biography written for one co-op is
   * not consent to publish it in another (D-020, IMP-17).
   */
  bio?: string | null;
  /** Links this member chose to show, in this co-op. http/https only. */
  links?: string[];
  /** One line under their name — what they do, what to ask them about. */
  headline?: string | null;
  /** Free text as they wrote it. Nothing geocodes it. */
  location?: string | null;
  /**
   * Whether they agreed to be emailed by this co-op. Organisers only — it
   * sits beside the email address it governs, and a member who cannot see
   * the address has no business knowing whether it may be written to.
   */
  emailOptIn?: boolean | null;
}

/**
 * An event's door list (IMP-10). Verified against a live response.
 *
 * `expected` is everyone who said they were coming; `walkIns` is everyone who
 * did not and turned up anyway. `attendanceCount` is what the impact
 * dashboard aggregates, returned here so the door and the report cannot
 * disagree about the same evening.
 */
export interface DoorList {
  expected: Array<{
    rsvpId: string;
    userId: string | null;
    name: string;
    avatarUrl: string | null;
    isGuest: boolean;
    status: string;
    plusOnes: number;
    checkedIn: boolean;
    checkedInAt: string | null;
  }>;
  walkIns: Array<{ attendanceId: string; name: string; createdAt: string }>;
  attendanceCount: number;
  expectedCount: number;
}

export interface Event {
  id: string;
  title: string;
  slug: string;
  description?: string;
  imageUrl?: string;
  startTime: string;
  endTime: string;
  timezone: string;
  visibility: string;
  category?: string;
  tags: string[];
  capacity?: number;
  /**
   * Whether people may still sign up once `capacity` is reached (EVT-02).
   * Returned by the org-scoped reads and declared here so an edit form
   * prefills it — a form that renders this unchecked on an event that has a
   * waitlist would switch it off the moment anything else was saved.
   */
  waitlistEnabled?: boolean;
  isPublished: boolean;
  /** CONFIRMED RSVPs only — cancelled and waitlisted are not attendees. */
  rsvpCount?: number;
  /**
   * Who runs this event (EVT-04). Present on org-scoped reads only — the
   * public endpoints deliberately omit it, so a member's name is not
   * published to the internet by default. Null when nobody is assigned,
   * which is true of every event created before the column existed.
   */
  host?: { id: string; name?: string; avatarUrl?: string } | null;
  /** What a ticket costs, in cents. Null means free — no Stripe involved. */
  priceCents?: number | null;
  currency?: string;
  /** The public event endpoint embeds a slice of the co-op. */
  org?: { id: string; name: string; slug: string; logoUrl?: string | null };
  location?: Location;
  room?: Room;
}

export interface CreateEventData {
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  visibility?: string;
  capacity?: number;
  /**
   * Keep a waitlist once `capacity` is reached (EVT-02). The engine that acts
   * on this has always worked; until now nothing in the product could set it,
   * so it stayed at its `false` default and never ran.
   */
  waitlistEnabled?: boolean;
  category?: string;
  locationId?: string;
  roomId?: string;
  /** Go live immediately rather than saving a draft (EVT-05). */
  publish?: boolean;
  /**
   * Who runs it (EVT-04). Only organisers may set this — a member creating an
   * event always hosts it themselves, since naming someone else would
   * volunteer them for the post-event follow-up.
   */
  hostId?: string;
  /**
   * What a ticket costs, in cents. Null or absent means free — and free is not
   * the same as zero-priced: a free event never touches Stripe.
   */
  priceCents?: number | null;
}

/**
 * Publishing an event from a room booking (EVT-05). Everything is optional —
 * the booking already answers when, where, and what the member called it.
 */
export interface PublishBookingEventData {
  title?: string;
  description?: string;
  visibility?: string;
  capacity?: number;
  category?: string;
  publish?: boolean;
  priceCents?: number | null;
}

/** Whether a co-op can take money for tickets yet (D-013, Stripe Connect). */
export interface ConnectStatus {
  connected: boolean;
  chargesEnabled: boolean;
  detailsSubmitted?: boolean;
  /** What Stripe still wants before this co-op can be paid. */
  requirements?: string[];
}

/**
 * An event the signed-in member hosts, drafts included.
 *
 * `location` and `room` come back as names only from this endpoint — a door
 * list needs the whole room, a list of your own events needs to say where.
 * Omitting the wider fields here keeps the type honest about what arrives.
 */
export interface HostedEvent extends Omit<Event, 'location' | 'room'> {
  isPast: boolean;
  canceledAt?: string | null;
  location?: { name: string } | null;
  room?: { name: string } | null;
}

export interface Room {
  id: string;
  name: string;
  description?: string;
  capacity?: number;
  amenities: string[];
  requiresApproval: boolean;
  memberOnly: boolean;
  /**
   * Whether hire is charged for (SPC-06). Off unless an admin switched it on
   * and set a rate — a rate on its own records what a room is worth without
   * billing anybody for it.
   */
  chargeForBooking?: boolean;
  /** Bookable at any hour, said deliberately rather than inferred. */
  alwaysAvailable?: boolean;
  /** Set once a Google Calendar is connected to this room (SPC-04). */
  googleCalendarId?: string | null;
  hourlyRate?: number | null;
  isActive?: boolean;
}

export interface CreateRoomData {
  name: string;
  description?: string;
  chargeForBooking?: boolean;
  capacity?: number;
  amenities?: string[];
  locationId?: string;
  requiresApproval?: boolean;
  memberOnly?: boolean;
  /** Bookable at any hour, rather than inferred from having no rules. */
  alwaysAvailable?: boolean;
  /** Cents per hour. Charged when `chargeForBooking` is on (SPC-06). */
  hourlyRate?: number;
}

export interface Booking {
  /** Set only on a room that charges for hire (SPC-06). */
  priceCents?: number | null;
  amountCents?: number | null;
  paidAt?: string | null;
  refundedAt?: string | null;
  id: string;
  roomId: string;
  title: string;
  startTime: string;
  endTime: string;
  status: string;
  /**
   * Present on `/my-bookings` only, and only these three columns — not a whole
   * `Room`. The per-room list omits it, since its caller already knows the
   * room. Declaring the full type invited a page to read `room.capacity` and
   * silently get undefined.
   */
  room?: Pick<Room, 'id' | 'name'> & { locationId?: string | null };
}

export interface CreateBookingData {
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
}

export interface Channel {
  id: string;
  name: string;
  slug: string;
  description?: string;
  isDefault: boolean;
  isPinned: boolean;
}

export interface Comment {
  id: string;
  body: string;
  parentId?: string | null;
  author: { id: string; name?: string; avatarUrl?: string };
  createdAt: string;
  replies: Comment[];
}

export interface Reaction {
  id: string;
  emoji: string;
  userId: string;
}

export interface Post {
  id: string;
  title?: string;
  body: string;
  author: { id: string; name?: string; avatarUrl?: string };
  createdAt: string;
  isPinned?: boolean;
  comments?: Comment[];
  reactions?: Reaction[];
  _count?: { comments: number; reactions: number };
}

export interface DirectMessage {
  id: string;
  senderId: string;
  receiverId: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  sender: { id: string; name?: string; avatarUrl?: string };
  receiver: { id: string; name?: string; avatarUrl?: string };
}

export interface DmConversation {
  counterpart: { id: string; name?: string; avatarUrl?: string };
  lastMessage: DirectMessage;
  unreadCount: number;
}

export interface CollectionPage {
  id: string;
  collectionId?: string;
  title: string;
  body: string;
  /** Position within its collection. A handbook is a sequence (CMN-09). */
  sortOrder?: number;
  updatedAt: string;
  author?: { id: string; name?: string; avatarUrl?: string };
}

export interface Collection {
  id: string;
  name: string;
  emoji: string;
  description?: string;
  pages: CollectionPage[];
}

export interface SearchResults {
  members: { id: string; name?: string; avatarUrl?: string }[];
  channels: Channel[];
  events: Event[];
  pages: (CollectionPage & { collection: { id: string; name: string; emoji: string } })[];
}

export interface Proposal {
  id: string;
  title: string;
  body: string;
  status: string;
  quorum?: number;
  closesAt?: string;
  /**
   * Named to match the API. This was declared as `votes`, which the API has
   * never returned in this shape — the list gave `_count.votes` (a number)
   * and the detail gives `voteTally` — so every read was undefined and every
   * proposal card rendered 0% (OPS-05).
   */
  voteTally?: { yes: number; no: number; abstain: number; total: number };
}

export interface MyRsvp {
  id: string;
  status: 'CONFIRMED' | 'WAITLISTED' | 'CANCELED' | 'TENTATIVE';
  plusOnes?: number;
  checkedIn?: boolean;
  eventCanceled: boolean;
  isPast: boolean;
  event: {
    id: string;
    title: string;
    slug: string;
    startTime: string;
    endTime: string;
    timezone?: string;
    capacity?: number | null;
    location?: { name: string } | null;
    room?: { name: string } | null;
  };
}

export interface Survey {
  id: string;
  title: string;
  description?: string;
  type: string;
  questions: SurveyQuestion[];
  isActive: boolean;
  _count?: { responses: number };
}

export interface SurveyQuestion {
  id: string;
  text: string;
  type: string;
  options?: string[];
  required?: boolean;
  category?: string;
}

export interface SubmitSurveyData {
  answers: Record<string, string | number | string[]>;
  demographics?: Record<string, string>;
}

/**
 * The impact dashboard, as `/orgs/:orgId/impact/dashboard` actually returns it.
 *
 * The previous shape (avgAttendance, surveyMetrics, trends, retentionByMonth)
 * described an endpoint that has never existed. No page reads it yet, so it
 * broke nothing — it was simply waiting to mislead whoever built the dashboard
 * screen. Verified against a live response.
 */
export interface ImpactDashboardData {
  totalMembers: number;
  totalEvents: number;
  totalResponses: number;
  /** Zero until event check-in has a caller (IMP-10) — reported, not hidden. */
  totalAttendance: number;
  /** Responses as a percentage of members. Can exceed 100 over many windows. */
  participationRate: number;
  /** Headline categories first (belonging, loneliness, network_size). */
  scores: Array<{
    category: string;
    average: number | null;
    answerCount: number;
  }>;
  surveys: Array<{
    surveyId: string;
    title: string;
    type: string;
    isActive: boolean;
    responses: number;
  }>;
  /** One entry per collection window, so a trend compares like with like. */
  windows: Array<{
    windowId: string;
    surveyId: string;
    surveyTitle: string;
    label: string;
    opensAt: string;
    closesAt: string | null;
    responses: number;
  }>;
}

/**
 * The member's demographic profile (IMP-17). Verified against a live response.
 *
 * The field list comes from the server rather than being duplicated here — a
 * second copy of the vocabulary would drift, and a mismatched key becomes a
 * question nobody can answer.
 */
export interface MyDemographics {
  fields: Array<{ key: string; label: string; options?: string[] }>;
  answers: Record<string, string>;
  /** Segments smaller than this are never reported. Shown to the member. */
  suppressionThreshold: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: { page: number; perPage: number; total: number; totalPages: number };
}

export interface Invitation {
  id: string;
  orgId: string;
  email: string;
  role: string;
  token: string;
  invitedBy: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export interface InviteTier {
  id: string;
  name: string;
  priceMonthly: number;
  priceYearly?: number | null;
}

export interface InviteInfo {
  id: string;
  email: string;
  role: string;
  org: { id: string; name: string; slug: string; logoUrl?: string; brandColor: string };
  expiresAt: string;
  /**
   * The tier this invitation is for (MEM-04), or null for a membership with
   * no dues. Shown before accepting rather than discovered at Stripe.
   */
  tier?: InviteTier | null;
}

/** A micro-question attached to a moment (IMP-15, PRD §6.2). */
export interface ReportBlock {
  id: string;
  kind: string;
  heading: string | null;
  body: string | null;
  generatedBody?: string | null;
  isEdited?: boolean;
  data?: Record<string, unknown> | null;
}


// ── Belonging Support (BEL) ──

export interface BelongingSettings {
  buddySystemEnabled: boolean;
  buddyInviteTimeoutHours: number;
  buddyAskCooldownDays: number;
  buddyServeCooldownDays: number;
  buddyMaxActivePairings: number;
  buddyFallbackAdminId: string | null;
  knowledgeCenterEnabled: boolean;
  requiredReadingGraceDays: number;
}

export interface BelongingEmailTemplate {
  kind: string;
  subject: string;
  body: string;
  /** Whether this is the co-op's own wording or the one MaybeOS ships. */
  isCustom: boolean;
  variables: string[];
}

export interface BuddyPairingRow {
  id: string;
  state: 'SEEKING' | 'ACTIVE' | 'NEEDS_ADMIN' | 'CLOSED';
  newMember: { id: string; name: string | null };
  buddy: { id: string; name: string | null } | null;
  pairedAt: string | null;
  createdAt: string;
  timesAsked: number;
  messageExchanged: boolean;
  firstMessageAt: string | null;
  /** Paired, but nobody has written anything — the failure worth acting on. */
  silent: boolean;
}

export interface BuddyInvitationRow {
  id: string;
  pairingId: string;
  candidate: { id: string; name: string | null };
  newMember: string | null;
  state: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'SUPERSEDED';
  sentAt: string;
  expiresAt: string;
  respondedAt: string | null;
  offTheHookSentAt: string | null;
}

export interface BuddyMemberRow {
  memberId: string;
  name: string | null;
  timesAsked: number;
  timesServed: number;
  lastAskedAt: string | null;
  lastServedAt: string | null;
  optedOut: boolean;
  activePairings: number;
}

export interface MyBuddyState {
  optedOut: boolean;
  timesServed: number;
  /** The new member I said yes to, if any. */
  buddyingFor: { pairingId: string; userId: string; name: string | null } | null;
  /** The person welcoming me, if anyone. */
  myBuddy: { pairingId: string; userId: string; name: string | null } | null;
}

export interface BuddySuggestion {
  id: string;
  body: string;
  position: number;
  active: boolean;
}

export interface ArticleAuthor {
  name: string | null;
  avatarUrl?: string | null;
  headline?: string | null;
}

export interface ArticleSummary {
  id: string;
  title: string;
  slug: string;
  state: 'DRAFT' | 'PUBLISHED';
  position: number;
  coverImageUrl?: string | null;
  requiresAcknowledgment: boolean;
  version: number;
  author: ArticleAuthor | null;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  acknowledgedByMe: boolean;
  /** "Rasul replied 10 months ago" or "Charley posted 2 years ago". */
  lastActivity: { kind: 'posted' | 'replied'; at: string; who: string | null };
}

export interface ArticleComment {
  id: string;
  body: string;
  createdAt: string;
  member: { id: string; user: { name: string | null; avatarUrl?: string | null } };
}

export interface Article extends Omit<ArticleSummary, 'lastActivity'> {
  body: string;
  publishedAt: string | null;
  createdAt: string;
  comments: ArticleComment[];
}

export interface OutstandingReading {
  blocking: Array<{ id: string; title: string; slug: string }>;
  inGrace: Array<{ article: { id: string; title: string; slug: string }; until: string }>;
  graceEndsAt: string | null;
}

export interface ArticleCompliance {
  article: { id: string; title: string; version: number; requiredSince: string | null };
  total: number;
  acknowledgedCount: number;
  percentage: number;
  outstanding: Array<{ memberId: string; name: string | null; email: string; memberSince: string }>;
}

export type ComposeStatus = 'NOT_NEEDED' | 'PENDING' | 'COMPOSING' | 'READY' | 'FAILED';

export interface ReportSummary {
  id: string;
  title: string;
  slug: string;
  status: 'DRAFT' | 'PUBLISHED';
  periodStart: string;
  periodEnd: string;
  publishedAt: string | null;
  generatedAt: string;
  /** BASIC is the free deterministic reading; WRITTEN is the $50 one. */
  tier: 'BASIC' | 'WRITTEN';
  /**
   * Whether the written report's prose has been written yet. It reads
   * correctly either way — a written report is the free report until the
   * composition lands over it — so this is a state, never a broken document.
   */
  composeStatus: ComposeStatus;
  composeNote?: string | null;
  _count?: { blocks: number };
}

export interface ImpactReport extends ReportSummary {
  blocks: ReportBlock[];
  /** The PRD's G4: how much of it a human rewrote. */
  editedShare: number;
}

/**
 * Whether the written report for this period is paid for (IMP-23).
 *
 * `required: false` is the free report, which is never gated — the page must
 * not offer to sell anything on it.
 */
export interface ReportPurchaseStatus {
  reportId: string;
  tier: 'BASIC' | 'WRITTEN';
  priceCents: number;
  required: boolean;
  paid: boolean;
  periodStart: string;
  periodEnd: string;
  coveredBy: {
    id: string;
    paidAt: string | null;
    periodStart: string;
    periodEnd: string;
  } | null;
}

export interface PublicReport {
  org: { name: string; slug: string; logoUrl: string | null; mission: string | null };
  report: {
    title: string;
    slug: string;
    periodStart: string;
    periodEnd: string;
    publishedAt: string | null;
    generatedAt: string;
    blocks: ReportBlock[];
  };
}

export interface Indicator {
  id: string;
  goalId: string;
  category: string;
  label: string;
}

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  sortOrder: number;
  indicators: Indicator[];
}

/** A way of measuring a goal, proposed rather than applied (IMP-21). */
export interface DraftedIndicator {
  category: string;
  label: string;
  /** The actual question wording, so an admin judges what will be asked. */
  questions: string[];
  because: string;
}

export interface MeasurementPlan {
  mission: string | null;
  status: 'DRAFT' | 'APPROVED';
  approvedAt: string | null;
  goals: Goal[];
  maxGoals: number;
  available: DraftedIndicator[];
}

export interface SignalsByGoal extends Signals {
  goals: Array<{
    goalId: string;
    title: string;
    description: string | null;
    unmeasured: boolean;
    measures: Array<{
      indicatorId: string;
      label: string;
      category: string;
      signal: SignalCategory | null;
    }>;
  }>;
  unclaimed: SignalCategory[];
}

export interface SignalCategory {
  category: string;
  /** Null when too few people answered to report without exposing one. */
  average: number | null;
  answerCount: number;
  respondents: number;
  reportable: boolean;
  /** False where a high score is bad news — loneliness, not belonging. */
  higherIsBetter: boolean;
}

export interface Signals {
  suppressionThreshold: number;
  members: number;
  categories: SignalCategory[];
  windows: Array<{
    windowId: string;
    label: string;
    opensAt: string;
    closesAt: string | null;
    responses: number;
    responseRate: number;
  }>;
}

export interface MyImpact {
  answers: Array<{
    question: string;
    type: string;
    anchorLow: string | null;
    anchorHigh: string | null;
    category: string | null;
    value: number | string | null;
    window: string;
    answeredAt: string;
  }>;
  community: Signals;
}

export interface StarterQuestion {
  key: string;
  text: string;
  type: string;
  category: string | null;
  touchpoint: string | null;
  anchorLow: string | null;
  anchorHigh: string | null;
}

export interface MeasurementStatus {
  installed: boolean;
  collecting: boolean;
  version: number;
  questions: StarterQuestion[];
  window: { id: string; label: string; opensAt: string; closesAt: string | null } | null;
  responseCount: number;
  answerCount: number;
}

export interface TouchpointAsk {
  id: string;
  surveyId: string;
  text: string;
  type: 'SCALE' | 'CHOICE' | 'TEXT' | 'NUMBER';
  options: string[];
  /** The two ends of a scale, in the member's language (IMP-18). */
  anchorLow?: string | null;
  anchorHigh?: string | null;
  category?: string | null;
}

/** One recorded expense (IMP-16). Four fields, deliberately. */
export interface Expense {
  id: string;
  amountCents: number;
  incurredOn: string;
  category: string;
  goalKey?: string | null;
  description?: string | null;
  creator?: { id: string; name?: string } | null;
}

export interface CreateExpenseData {
  amountCents: number;
  incurredOn: string;
  category: string;
  goalKey?: string;
  description?: string;
}

export interface ExpenseSummary {
  totalCents: number;
  byCategory: { category: string; totalCents: number; count: number }[];
  byGoal: { goalKey: string | null; totalCents: number; count: number }[];
  /** 0–1, or null when nothing has been recorded — not the same as zero. */
  attributedShare: number | null;
  expenseCount: number;
}
