import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './config/configureApp';
import { validateEnv } from './config/validateEnv';

async function bootstrap() {
  // Before the app exists: a missing or weak secret must stop the process
  // before any module is instantiated or a port is opened.
  validateEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);

  await app.listen(process.env.PORT ?? 3333);
}

void bootstrap();
