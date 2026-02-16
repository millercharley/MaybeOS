import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.enableCors({
    origin: process.env.WEB_URL || 'http://localhost:3000',
    credentials: true,
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

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
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`MaybeOS API running on http://localhost:${port}`);
  console.log(`Swagger docs at http://localhost:${port}/api/docs`);
}

bootstrap();
