import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import express from 'express';
import { AppModule } from '../src/app.module';

let expressApp: express.Application;

async function bootstrap() {
  const server = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server));

  await app.init();

  return server;
}

export default async function (req: Request, res: Response) {
  if (!expressApp) {
    expressApp = await bootstrap();
  }

  expressApp(req, res);
}
