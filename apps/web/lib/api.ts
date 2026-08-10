import * as Sentry from '@sentry/nextjs';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface FetchOptions extends RequestInit {
  token?: string;
  orgId?: string;
}

/**
 * Strip anything credential-shaped out of a path before it is used in a
 * Sentry message, tag, or fingerprint. `/auth/magic-link/verify?token=...`
 * and `/invites/<token>` both embed a working credential in the path itself.
 */
function safePath(path: string): string {
  return path
    .split('?')[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/[A-Za-z0-9_-]{24,}/g, '/:token');
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
      Sentry.captureException(err, {
        level: 'error',
        tags: { 'api.method': method, 'api.route': route },
        fingerprint: ['api-unreachable', method, route],
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
  orgs = {
    create: (data: CreateOrgData, token: string) =>
      this.request<Org>('/orgs', { method: 'POST', body: JSON.stringify(data), token }),

    get: (orgId: string, token: string) =>
      this.request<Org>(`/orgs/${orgId}`, { token }),

    getBySlug: (slug: string) =>
      this.request<Org>(`/orgs/by-slug/${slug}`),

    update: (orgId: string, data: Partial<CreateOrgData> & { brandColor?: string }, token: string) =>
      this.request<Org>(`/orgs/${orgId}`, { method: 'PATCH', body: JSON.stringify(data), token }),

    listTiers: (orgId: string) =>
      this.request<MembershipTier[]>(`/orgs/${orgId}/tiers`),
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

    listPublic: async (orgId: string): Promise<Event[]> => {
      const res = await this.request<PaginatedResponse<Event>>(`/orgs/${orgId}/events/public`);
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

    rsvp: (orgId: string, eventId: string, token: string) =>
      this.request(`/orgs/${orgId}/events/${eventId}/rsvp`, { method: 'POST', token }),

    publicFeedJson: (orgId: string) =>
      this.request<Event[]>(`/orgs/${orgId}/events/feed.json`),

    getPublicBySlug: (orgSlug: string, eventSlug: string) =>
      this.request<Event>(`/orgs/${orgSlug}/events/by-slug/${eventSlug}`),

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

    listBookings: (orgId: string, roomId: string, token: string) =>
      this.request<Booking[]>(`/orgs/${orgId}/rooms/${roomId}/bookings`, { token }),

    myBookings: (orgId: string, token: string) =>
      this.request<Booking[]>(`/orgs/${orgId}/my-bookings`, { token }),

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
  };

  // ── Stripe ───────────────────────────────────────
  stripe = {
    createCheckout: (orgId: string, data: { tierId: string; successUrl: string; cancelUrl: string }, token: string) =>
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
 * Callers that show "check your connection" style messaging should branch on
 * this rather than on the message text.
 */
export class ApiNetworkError extends Error {
  constructor(
    public method: string,
    public route: string,
    public cause?: unknown,
  ) {
    super(`API unreachable: ${method} ${route}`);
    this.name = 'ApiNetworkError';
  }
}

export const api = new ApiClient(API_BASE);

// ── Type definitions ─────────────────────────────────

export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  globalRole: string;
  orgs: Array<{
    orgId: string;
    orgName: string;
    orgSlug: string;
    role: string;
    tierId?: string;
    subscriptionStatus: string;
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
  locations?: Location[];
  tiers?: MembershipTier[];
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

export interface MembershipTier {
  id: string;
  name: string;
  description?: string;
  priceMonthly: number;
  priceYearly?: number;
  isPayWhatYouCan: boolean;
  benefits: string[];
}

export interface Member {
  id: string;
  user: { id: string; email: string; name?: string; avatarUrl?: string };
  role: string;
  tier?: MembershipTier;
  subscriptionStatus: string;
  memberSince: string;
  tags: string[];
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
  rsvpCount?: number;
  location?: Location;
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
}

export interface Room {
  id: string;
  name: string;
  description?: string;
  capacity?: number;
  amenities: string[];
  requiresApproval: boolean;
  memberOnly: boolean;
}

export interface CreateRoomData {
  name: string;
  description?: string;
  capacity?: number;
  amenities?: string[];
  requiresApproval?: boolean;
}

export interface Booking {
  id: string;
  roomId: string;
  title: string;
  startTime: string;
  endTime: string;
  status: string;
  room?: Room;
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
  votes?: { yes: number; no: number; abstain: number; total: number };
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

export interface ImpactDashboardData {
  totalMembers: number;
  totalEvents: number;
  avgAttendance: number;
  surveyMetrics: Record<string, number>;
  trends: Array<{ month: string; belonging: number; participation: number }>;
  retentionByMonth: Array<{ month: string; count: number }>;
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
