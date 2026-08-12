import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
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
