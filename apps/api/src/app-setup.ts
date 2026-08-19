import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { AvatarUrlInterceptor } from './common/avatars/avatar-url.interceptor';
import { StorageService } from './modules/storage/storage.service';

/**
 * Shared setup applied to every Nest app instance, whether it ends up
 * behind `app.listen()` (traditional server — local dev, Docker)
 * or wrapped by serverless-http for Netlify Functions (see lambda.ts).
 * Kept in its own side-effect-free module so importing it never triggers
 * main.ts's `bootstrap()` (which listens on a port) as a side effect.
 */
export async function configureApp(app: NestExpressApplication) {
  // Sentry is initialized in instrument.ts, imported before anything else by
  // each entry point — it cannot be done here, after Nest has already booted.
  app.useLogger(app.get(PinoLogger));

  // Logos arrive as base64 in a JSON body (OPS-03c), and Express defaults to a
  // 100 kB JSON limit — small enough that a 70-byte test image passes and any
  // real logo fails with "request entity too large". The bucket caps images at
  // 2 MB, which is ~2.7 MB once base64-encoded, so 4 MB leaves headroom for the
  // JSON around it while staying well inside Netlify's 6 MB request ceiling.
  app.useBodyParser('json', { limit: '4mb' });
  app.useBodyParser('urlencoded', { limit: '4mb', extended: true });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  const allowedOrigins = (process.env.WEB_URL || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());

  const baseDomains = allowedOrigins
    .map((o) => { try { return new URL(o).hostname.split('.').slice(-2).join('.'); } catch { return null; } })
    .filter(Boolean);

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      try {
        const hostname = new URL(origin).hostname;
        if (baseDomains.some((base) => hostname === base || hostname.endsWith('.' + base))) {
          return callback(null, true);
        }
      } catch {
        // A malformed Origin header is not a permitted origin. Falling
        // through to the rejection below is the whole intent.
      }
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Org-Id', 'X-Org-Slug'],
  });

  app.setGlobalPrefix('api');
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Avatars live in a private bucket, so a stored path has to be signed before
  // a browser can load it. Applied globally rather than per service: doing it
  // in each one is what left an imported member with a face in the directory
  // and a grey initial everywhere else (MEM-10).
  app.useGlobalInterceptors(new AvatarUrlInterceptor(app.get(StorageService)));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('MaybeOS Suite API')
      .setDescription('Multi-tenant community platform API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .addTag('auth', 'Authentication & authorization')
      .addTag('orgs', 'Organization management (OrgOS)')
      .addTag('members', 'Membership & dues (MemberOS)')
      .addTag('events', 'Events & gatherings (EventsOS)')
      .addTag('space', 'Room booking (SpaceOS)')
      .addTag('commons', 'Social & governance (CommonsOS)')
      .addTag('impact', 'Surveys & metrics (ImpactOS)')
      .addTag('stripe', 'Stripe webhooks')
      .addTag('health', 'Health checks')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  return app;
}
