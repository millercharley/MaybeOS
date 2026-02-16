# MaybeOS Suite

A multi-tenant web platform that helps communities launch and sustain cooperative gathering spaces and member-run organizations. MaybeOS unifies org setup, membership & dues, events, space booking, community messaging & governance, and impact measurement into one integrated suite.

## Architecture

**Modular monolith** with clear module boundaries, designed to evolve into services.

```
maybeos-suite/
├── apps/
│   ├── api/          # NestJS backend (TypeScript)
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/       # JWT + magic links, RBAC
│   │   │   │   ├── org/        # OrgOS - tenant management
│   │   │   │   ├── member/     # MemberOS - memberships & tiers
│   │   │   │   ├── events/     # EventsOS - events, RSVP, feeds
│   │   │   │   ├── space/      # SpaceOS - rooms & bookings
│   │   │   │   ├── commons/    # CommonsOS - posts, governance
│   │   │   │   ├── impact/     # ImpactOS - surveys & metrics
│   │   │   │   ├── stripe/     # Stripe integration
│   │   │   │   ├── email/      # Email automation (Postmark)
│   │   │   │   └── calendar/   # Google Calendar sync
│   │   │   ├── common/         # Guards, decorators, filters
│   │   │   └── config/         # Prisma, app config
│   │   └── prisma/
│   │       ├── schema.prisma   # Full database schema
│   │       └── seeds/          # Demo seed data
│   └── web/          # Next.js frontend (App Router, TypeScript)
│       ├── app/
│       │   ├── (auth)/         # Login, register, magic link
│       │   ├── (dashboard)/    # Admin & member portal
│       │   └── (public)/       # Public events, org pages
│       ├── components/         # UI components
│       └── lib/                # API client, auth store
├── packages/
│   ├── shared/       # Shared types, constants, domain events
│   └── embed/        # Embeddable calendar widget
├── docker-compose.yml
└── package.json      # Workspace root
```

## The Six Modules

| Module | Purpose | Key Features |
|--------|---------|--------------|
| **OrgOS** | Organization setup | Tenant creation, locations, branding, RBAC, settings |
| **MemberOS** | Membership & dues | Tiers, Stripe subscriptions, directory, CSV import |
| **EventsOS** | Events & gatherings | CRUD, RSVP + waitlist, public pages, JSON/ICS feeds |
| **SpaceOS** | Room booking | Availability rules, conflict detection, Google Calendar sync |
| **CommonsOS** | Social & governance | Channels, posts, proposals, voting, moderation |
| **ImpactOS** | Impact measurement | Surveys, belonging/loneliness metrics, dashboards, export |

## Tech Stack

- **Frontend**: Next.js 15 (App Router), TypeScript, Tailwind CSS, Zustand, Lucide icons
- **Backend**: NestJS 10, TypeScript, Prisma ORM, Passport JWT
- **Database**: PostgreSQL 16 with row-level tenancy (`orgId` on all tables)
- **Queue**: BullMQ + Redis for async jobs (emails, calendar sync, webhooks)
- **Integrations**: Stripe Billing, Google Calendar API, Postmark email
- **Auth**: Email/password + magic links, JWT tokens, RBAC (Admin/Staff/Member/Guest)

## Prerequisites

- Node.js >= 20
- Docker & Docker Compose (for Postgres + Redis)
- Stripe account (test mode) for payment features
- Google Cloud project (optional, for calendar sync)
- Postmark account (optional, for emails)

## Quick Start

### 1. Clone and install

```bash
git clone <repo-url> maybeos-suite
cd maybeos-suite
npm install
```

### 2. Start infrastructure

```bash
docker compose up -d
```

This starts PostgreSQL (port 5432) and Redis (port 6379).

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/maybeos_dev"
JWT_SECRET="generate-a-random-64-char-string"
STRIPE_SECRET_KEY="sk_test_..."          # from Stripe dashboard
STRIPE_WEBHOOK_SECRET="whsec_..."        # from stripe listen
GOOGLE_CLIENT_ID=""                       # optional
POSTMARK_API_TOKEN=""                     # optional (logs emails in dev)
```

### 4. Set up database

```bash
cd apps/api
npx prisma generate
npx prisma migrate dev --name init
npm run db:seed
```

### 5. Run the application

From the repo root:

```bash
npm run dev
```

This starts:
- **API** at `http://localhost:3001` (Swagger docs at `/api/docs`)
- **Web** at `http://localhost:3000`

## Demo Accounts

All passwords: `password123`

| Email | Role | Org Role |
|-------|------|----------|
| `admin@maybeos.app` | Platform Admin | Org Admin |
| `maya@sunrise.coop` | User | Org Admin (Steward tier) |
| `jordan@sunrise.coop` | User | Staff (Supporter tier) |
| `alex@example.com` | User | Member (Supporter tier) |
| `sam@example.com` | User | Member (Community tier) |

Demo organization: **Sunrise Community Space** (slug: `sunrise`)

## API Documentation

Swagger UI is available at `http://localhost:3001/api/docs` when the API is running.

### Key Endpoints

#### Auth
```
POST /api/auth/register          # Create account
POST /api/auth/login             # Email + password login
POST /api/auth/magic-link        # Request magic link
GET  /api/auth/magic-link/verify # Verify magic link token
GET  /api/auth/profile           # Get current user profile
```

#### Organizations (OrgOS)
```
POST /api/orgs                   # Create organization
GET  /api/orgs/:orgId            # Get org details
GET  /api/orgs/by-slug/:slug     # Public org lookup
PATCH /api/orgs/:orgId           # Update org (Admin)
POST /api/orgs/:orgId/locations  # Add location (Admin)
```

#### Members (MemberOS)
```
GET  /api/orgs/:orgId/members    # List members
GET  /api/orgs/:orgId/tiers      # List membership tiers (public)
POST /api/orgs/:orgId/tiers      # Create tier (Admin)
POST /api/orgs/:orgId/members/import  # CSV import (Admin)
```

#### Events (EventsOS)
```
POST /api/orgs/:orgId/events              # Create event
GET  /api/orgs/:orgId/events/public       # Public events (no auth)
GET  /api/orgs/:orgId/events/feed.json    # JSON feed (cacheable)
GET  /api/orgs/:orgId/events/feed.ics     # ICS calendar feed
POST /api/orgs/:orgId/events/:id/rsvp     # RSVP
POST /api/orgs/:orgId/events/:id/check-in/:userId  # Check in
```

#### Rooms & Booking (SpaceOS)
```
POST /api/orgs/:orgId/rooms               # Create room (Admin)
GET  /api/orgs/:orgId/rooms               # List rooms
POST /api/orgs/:orgId/rooms/:id/bookings  # Create booking
POST /api/orgs/:orgId/bookings/:id/approve  # Approve (Admin/Staff)
GET  /api/orgs/:orgId/my-bookings         # User's bookings
```

#### Commons (CommonsOS)
```
POST /api/orgs/:orgId/channels                    # Create channel
POST /api/orgs/:orgId/channels/:id/posts           # Create post
POST /api/orgs/:orgId/channels/:id/proposals        # Create proposal
POST /api/orgs/:orgId/proposals/:id/vote            # Cast vote
GET  /api/orgs/:orgId/proposals/:id                 # Get proposal + tallies
```

#### Impact (ImpactOS)
```
POST /api/orgs/:orgId/surveys                  # Create survey
POST /api/orgs/:orgId/surveys/:id/respond       # Submit response
GET  /api/orgs/:orgId/impact/dashboard          # Impact dashboard
GET  /api/orgs/:orgId/surveys/:id/export        # Export CSV
```

#### Stripe
```
POST /api/orgs/:orgId/checkout        # Create Stripe Checkout session
POST /api/orgs/:orgId/billing-portal  # Create Billing Portal session
POST /api/stripe/webhooks             # Stripe webhook handler
```

## Stripe Integration

### Setup

1. Create a [Stripe](https://stripe.com) account and get test API keys
2. Add keys to `.env`
3. For local webhook testing:
   ```bash
   stripe listen --forward-to localhost:3001/api/stripe/webhooks
   ```
4. Copy the webhook signing secret to `STRIPE_WEBHOOK_SECRET`

### Flows

- **Join + Pay**: Member selects tier -> Stripe Checkout -> Webhook confirms subscription -> Member activated
- **Manage Billing**: Member clicks "Manage Billing" -> Stripe Billing Portal -> Update payment method, cancel, etc.
- **Dunning**: `invoice.payment_failed` webhook -> Status set to PAST_DUE -> Dunning email queued

## Google Calendar Sync

### Setup

1. Create a Google Cloud project, enable Calendar API
2. Create OAuth 2.0 credentials (Web application)
3. Set redirect URI to `http://localhost:3001/api/calendar/oauth/callback`
4. Add credentials to `.env`

### Flow

1. Admin connects room to Google Calendar via OAuth
2. When a booking is approved, event is created on the shared calendar
3. Free/busy checks query Google Calendar for conflicts
4. Updates and cancellations are synced bidirectionally

## Public Calendar Embed

Embed the events calendar on any website:

### Script Tag

```html
<div id="maybeos-calendar"></div>
<script
  src="https://your-app.com/embed/calendar.js"
  data-org="sunrise"
  data-theme="light"
  data-api="https://api.your-app.com"
></script>
```

### React Component

```tsx
import { MaybeOSCalendarWidget } from '@maybeos/embed';

// Initialize in useEffect
const widget = new MaybeOSCalendarWidget({
  orgSlug: 'sunrise',
  apiUrl: 'https://api.your-app.com',
});
widget.init();
```

## Domain Events

The platform emits domain events for cross-module communication:

```
org.created, org.updated
member.joined, member.left, member.role_changed
subscription.created, subscription.canceled, subscription.past_due
event.published, event.canceled, rsvp.created
booking.created, booking.approved, booking.rejected
post.created, proposal.opened, proposal.closed, vote.cast
survey.published, survey.submitted
```

## Security

- **Tenant isolation**: All queries scoped by `orgId`; row-level tenancy enforced
- **Input validation**: class-validator on all DTOs, global ValidationPipe
- **Auth**: JWT with configurable expiry, bcrypt password hashing, magic link tokens with 15-min expiry
- **RBAC**: Role-based guards (ADMIN, STAFF, MEMBER, GUEST) per organization
- **Rate limiting**: Helmet security headers enabled
- **Stripe webhooks**: Signature verification with idempotency checks
- **Encrypted tokens**: Google Calendar OAuth tokens stored encrypted
- **Audit logs**: All admin actions logged with actor, action, entity, timestamp

## Development

```bash
# Run both API + Web
npm run dev

# Database commands
npm run db:migrate          # Run migrations
npm run db:seed             # Seed demo data
npm run db:studio           # Open Prisma Studio

# Individual apps
npm run dev:api             # API only
npm run dev:web             # Web only

# Build
npm run build               # Build all
```

## License

MIT
