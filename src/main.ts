import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as Sentry from '@sentry/node';
import { AppModule } from './app.module';
import { configureApp } from './config/configureApp';
import { validateEnv } from './config/validateEnv';
import { beforeSend } from './error-monitoring/sentryScrub';

// Read directly from process.env, not ConfigService: Sentry must be
// initialized before NestFactory.create() even runs, so no Nest DI
// container exists yet to resolve it through. validateEnv() above already
// guarantees SENTRY_DSN is present and well-formed.
function initSentry(): void {
  try {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      // ADR-006's first layer: the Node SDK's current, more granular
      // replacement for the older `sendDefaultPii: false` flag — explicitly
      // disables the exact categories the PRD forbids (bodies, cookies,
      // headers). `beforeSend` below is the second, independent layer.
      dataCollection: {
        httpBodies: [],
        cookies: false,
        httpHeaders: false,
      },
      beforeSend,
    });
  } catch (error) {
    // An SDK init failure must never block app boot.

    console.error('sentry_init_failed', error);
  }
}

async function bootstrap() {
  // Before the app exists: a missing or weak secret must stop the process
  // before any module is instantiated or a port is opened.
  validateEnv();
  initSentry();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);

  await app.listen(process.env.PORT ?? 3333);
}

void bootstrap();
