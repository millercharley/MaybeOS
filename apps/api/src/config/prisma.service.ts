import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { withConnectionDefaults } from './database-url';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      /**
       * One connection per Lambda container (OPS-11). Forced here rather than
       * left to `DATABASE_URL`, because that is exactly where the previous fix
       * was and exactly why it disappeared — see `database-url.ts`.
       */
      datasources: {
        db: { url: withConnectionDefaults(process.env.DATABASE_URL) },
      },
      log:
        process.env.NODE_ENV === 'development'
          ? ['query', 'info', 'warn', 'error']
          : ['error'],
      /**
       * Secrets that must never leave the server by accident.
       *
       * `Room.googleTokens` holds the co-op's Google Calendar OAuth tokens —
       * including the refresh token, which does not expire. Every room read
       * used `include`, which selects every column, so those tokens shipped in
       * the room list, the room detail, and — because events embed their room
       * — the *unauthenticated* public event page. Anyone who could load a
       * co-op's public event could take its calendar credentials.
       *
       * Omitting at the client makes redaction the default for every query
       * that exists and every query anyone writes later. The calendar module,
       * which genuinely needs the tokens, opts back in per query with
       * `omit: { googleTokens: false }` — an explicit, greppable exception
       * rather than a silent inclusion.
       */
      omit: {
        room: { googleTokens: true },
        /**
         * The co-op's Stripe Connect account id. `GET /orgs/:orgId` is
         * unauthenticated — it backs the public org page — and returns the
         * whole row, so adding this column for ticketing published every
         * co-op's connected account id to anyone who asked. Not a credential,
         * but an internal identifier that belongs between MaybeOS and Stripe.
         *
         * ConnectService opts back in per query; it is the only thing that
         * needs it.
         */
        /**
         * `doorScriptSecret` (DOR-01) signs writes to a co-op's door sheet.
         * Sealed at rest, and still omitted: `GET /orgs/:orgId` returns the
         * whole row, and ciphertext has no business in that response. The
         * door module opts back in.
         */
        organization: { stripeAccountId: true, doorScriptSecret: true },
        /**
         * A member's demographic answers (IMP-17). D-021 and the PRD are
         * explicit that no route reads another member's profile and that the
         * only admin view is a suppressed aggregate — but `getMember` and the
         * member list both read `UserOrg` with `include`, which selects every
         * column, so opening the directory returned every member's
         * demographics to anyone in the co-op.
         *
         * Nothing rendered them, which is exactly why it went unnoticed: the
         * data was in the response, one devtools panel away, for a field
         * collected on the promise that only aggregates would be shown.
         *
         * ImpactOS reads them with an explicit `select`, which is the one
         * place that should.
         */
        /**
         * A member's demographic answers, and their door code (DOR-01).
         *
         * The code is a physical credential: five letters that open a real
         * building. The same `include` that leaked demographics — `getMember`
         * and the member list both read `UserOrg` that way — would hand every
         * member's door code to anybody who opened the directory.
         *
         * Three places opt back in, each with an explicit `select`: the
         * member's own profile, the organisers' member list, and the sheet
         * sync. Nothing else has any business with it.
         */
        userOrg: { demographics: true, doorPin: true },
        /**
         * A share holder's email (MEM-17). Stored so a grant from the co-op's
         * cap table finds its member the day they join; used for that match on
         * the server and nowhere else. The ledger is read by every member, and
         * a member list with addresses attached is the exact thing the
         * directory promised not to be.
         */
        shareGrant: { holderEmail: true },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
