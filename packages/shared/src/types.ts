// ─── API Response Wrapper ────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  meta?: {
    page?: number;
    perPage?: number;
    total?: number;
    totalPages?: number;
  };
}

export interface ApiError {
  statusCode: number;
  message: string;
  error?: string;
}

// ─── Auth ────────────────────────────────────────────────────

export interface LoginDto {
  email: string;
  password: string;
}

export interface MagicLinkDto {
  email: string;
  orgSlug?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
}

export interface JwtPayload {
  sub: string; // userId
  email: string;
  globalRole: string;
  orgRoles: Record<string, string>; // orgId -> role
}

// ─── Organization ────────────────────────────────────────────

export interface CreateOrgDto {
  name: string;
  slug: string;
  description?: string;
  mission?: string;
  timezone?: string;
}

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string;
  brandColor: string;
  memberCount?: number;
}

// ─── Membership ──────────────────────────────────────────────

export interface CreateTierDto {
  name: string;
  description?: string;
  priceMonthly: number;
  priceYearly?: number;
  isPayWhatYouCan?: boolean;
  minPrice?: number;
  benefits?: string[];
}

export interface JoinOrgDto {
  tierId: string;
  paymentMethodId?: string; // for Stripe
}

// ─── Events ──────────────────────────────────────────────────

export type EventVisibility = 'PUBLIC' | 'MEMBERS_ONLY' | 'PRIVATE';
export type RecurrenceRule = 'NONE' | 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
export type RsvpStatus = 'CONFIRMED' | 'WAITLISTED' | 'CANCELED' | 'TENTATIVE';

export interface CreateEventDto {
  title: string;
  description?: string;
  richDescription?: string;
  locationId?: string;
  roomId?: string;
  startTime: string; // ISO 8601
  endTime: string;
  timezone?: string;
  visibility?: EventVisibility;
  recurrence?: RecurrenceRule;
  recurrenceEnd?: string;
  capacity?: number;
  waitlistEnabled?: boolean;
  category?: string;
  tags?: string[];
}

export interface PublicEventDto {
  id: string;
  title: string;
  slug: string;
  description?: string;
  imageUrl?: string;
  startTime: string;
  endTime: string;
  timezone: string;
  category?: string;
  tags: string[];
  location?: {
    name: string;
    address?: string;
    city?: string;
  };
  rsvpCount: number;
  capacity?: number;
  orgName: string;
  orgSlug: string;
}

// ─── Bookings ────────────────────────────────────────────────

export type BookingStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED';

export interface CreateBookingDto {
  roomId: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
}

// ─── Commons / Governance ────────────────────────────────────

export interface CreatePostDto {
  channelId: string;
  title?: string;
  body: string;
}

export interface CreateProposalDto {
  channelId: string;
  title: string;
  body: string;
  quorum?: number;
  closesAt?: string;
}

export type VoteChoice = 'YES' | 'NO' | 'ABSTAIN';

// ─── Impact / Surveys ────────────────────────────────────────

export type SurveyType = 'BASELINE' | 'FOLLOWUP' | 'CUSTOM';

export interface SurveyQuestion {
  id: string;
  text: string;
  type: 'likert' | 'number' | 'text' | 'choice' | 'multi_choice';
  options?: string[];
  required?: boolean;
  category?: string; // belonging, loneliness, network, participation, civic
}

export interface CreateSurveyDto {
  title: string;
  description?: string;
  type?: SurveyType;
  questions: SurveyQuestion[];
  closesAt?: string;
}

export interface SubmitSurveyDto {
  answers: Record<string, string | number | string[]>;
  demographics?: Record<string, string>;
}
