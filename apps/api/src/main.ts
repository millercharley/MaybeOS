// Must be first: Sentry instruments modules as they load (see instrument.ts).
import './instrument';

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { configureApp } from './app-setup';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });

  await configureApp(app);

  const port = process.env.PORT || 3001;
  await app.listen(port);
  logger.log(`MaybeOS API running on port ${port}`);
  if (process.env.NODE_ENV !== 'production') {
    logger.log(`Swagger docs at http://localhost:${port}/api/docs`);
  }
}

bootstrap();
