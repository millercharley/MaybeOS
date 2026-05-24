const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface FetchOptions extends RequestInit {
  token?: string;
  orgId?: string;
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

    const response = await fetch(`${this.baseUrl}/api${path}`, {
      ...fetchOptions,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new ApiError(response.status, error.message || 'Request failed');
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

    listPosts: (orgId: string, channelId: string, token: string) =>
      this.request<PaginatedResponse<Post>>(`/orgs/${orgId}/channels/${channelId}/posts`, { token }),

    createPost: (orgId: string, channelId: string, data: { title?: string; body: string }, token: string) =>
      this.request<Post>(`/orgs/${orgId}/channels/${channelId}/posts`, {
        method: 'POST',
        body: JSON.stringify(data),
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
}

export interface Post {
  id: string;
  title?: string;
  body: string;
  author: { id: string; name?: string; avatarUrl?: string };
  createdAt: string;
  _count?: { comments: number };
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

export interface InviteInfo {
  id: string;
  email: string;
  role: string;
  org: { id: string; name: string; slug: string; logoUrl?: string; brandColor: string };
  expiresAt: string;
}
