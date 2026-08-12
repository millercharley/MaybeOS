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

    return response.json();
  }

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

  // ── Orgs ─────────────────────────────────────────
  auth_profile = {
    update: (data: { name?: string; avatarUrl?: string | null }, token: string) =>
      this.request<UserProfile>('/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify(data),
        token,
      }),
  };

  orgs = {
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

    get: (orgId: string, userId: string, token: string) =>
      this.request<Member>(`/orgs/${orgId}/members/${userId}`, { token }),

    invite: (orgId: string, data: { email: string; role?: string }, token: string) =>
      this.request<{ id: string; email: string; status: string }>(`/orgs/${orgId}/members/invite`, {
        method: 'POST',
        body: JSON.stringify(data),
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

    accept: (inviteToken: string, authToken: string) =>
      this.request<{ status: string; orgId: string }>(`/invites/accept?token=${inviteToken}`, {
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

    rsvp: (orgId: string, eventId: string, token: string) =>
      this.request(`/orgs/${orgId}/events/${eventId}/rsvp`, { method: 'POST', token }),

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

    createBooking: (orgId: string, roomId: string, data: CreateBookingData, token: string) =>
      this.request<Booking>(`/orgs/${orgId}/rooms/${roomId}/bookings`, {
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

    createCollection: (orgId: string, data: { name: string; emoji?: string; description?: string }, token: string) =>
      this.request<Collection>(`/orgs/${orgId}/collections`, { method: 'POST', body: JSON.stringify(data), token }),

    deleteCollection: (orgId: string, collectionId: string, token: string) =>
      this.request(`/orgs/${orgId}/collections/${collectionId}`, { method: 'DELETE', token }),

    getPage: (orgId: string, pageId: string, token: string) =>
      this.request<CollectionPage>(`/orgs/${orgId}/pages/${pageId}`, { token }),

    createPage: (orgId: string, collectionId: string, data: { title: string; body: string }, token: string) =>
      this.request<CollectionPage>(`/orgs/${orgId}/collections/${collectionId}/pages`, {
        method: 'POST',
        body: JSON.stringify(data),
        token,
      }),

    updatePage: (orgId: string, pageId: string, data: { title?: string; body?: string }, token: string) =>
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

export interface Location {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
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
  hourlyRate?: number | null;
  isActive?: boolean;
}

export interface CreateRoomData {
  name: string;
  description?: string;
  capacity?: number;
  amenities?: string[];
  locationId?: string;
  requiresApproval?: boolean;
  memberOnly?: boolean;
  /** Cents per hour. Stored but not yet charged — see SPC-06. */
  hourlyRate?: number;
}

export interface Booking {
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

export interface InviteInfo {
  id: string;
  email: string;
  role: string;
  org: { id: string; name: string; slug: string; logoUrl?: string; brandColor: string };
  expiresAt: string;
}
