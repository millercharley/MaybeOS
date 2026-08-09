import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import * as Joi from 'joi';
import { PrismaModule } from './config/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { OrgModule } from './modules/org/org.module';
import { MemberModule } from './modules/member/member.module';
import { EventsModule } from './modules/events/events.module';
import { SpaceModule } from './modules/space/space.module';
import { CommonsModule } from './modules/commons/commons.module';
import { ImpactModule } from './modules/impact/impact.module';
import { StripeModule } from './modules/stripe/stripe.module';
import { EmailModule } from './modules/email/email.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),
        PORT: Joi.number().default(3001),
        DATABASE_URL: Joi.string().required(),
        JWT_SECRET: Joi.string().min(32).required(),
        JWT_EXPIRES_IN: Joi.string().default('7d'),
        WEB_URL: Joi.string().default('http://localhost:3000'),
        API_URL: Joi.string().default('http://localhost:3001'),
        SENTRY_DSN: Joi.string().allow('').default(''),
        STRIPE_SECRET_KEY: Joi.string().allow('').default(''),
        STRIPE_WEBHOOK_SECRET: Joi.string().allow('').default(''),
        GOOGLE_CLIENT_ID: Joi.string().allow('').default(''),
        GOOGLE_CLIENT_SECRET: Joi.string().allow('').default(''),
        GOOGLE_REDIRECT_URI: Joi.string().allow('').default(''),
        POSTMARK_API_TOKEN: Joi.string().allow('').default(''),
        EMAIL_FROM: Joi.string().default('noreply@maybeos.app'),
      }),
      validationOptions: {
        abortEarly: true,
      },
    }),

    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get('NODE_ENV') === 'production' ? 'info' : 'debug',
          transport:
            config.get('NODE_ENV') !== 'production'
              ? { target: 'pino-pretty', options: { colorize: true } }
              : undefined,
          redact: ['req.headers.authorization', 'req.headers.cookie'],
        },
      }),
    }),

    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,
        limit: 3,
      },
      {
        name: 'medium',
        ttl: 10000,
        limit: 20,
      },
      {
        name: 'long',
        ttl: 60000,
        limit: 100,
      },
    ]),

    PrismaModule,
    HealthModule,
    AuthModule,
    OrgModule,
    MemberModule,
    EventsModule,
    SpaceModule,
    CommonsModule,
    ImpactModule,
    StripeModule,
    EmailModule,
    CalendarModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
