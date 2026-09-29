import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { splitList } from './validateEnv';
import { createValidationPipe } from './validationPipe';

// Production sits behind exactly one reverse proxy (the hosting platform's
// edge), which overwrites X-Forwarded-For; anywhere else nothing is trusted,
// so a client can't spoof its own IP past the per-IP throttle.
const PRODUCTION_PROXY_HOPS = 1;

export function resolveCorsOrigins(env: NodeJS.ProcessEnv): string[] {
  const urls = [env.APP_URL ?? '', ...splitList(env.CORS_ALLOWED_ORIGINS)];
  return [...new Set(urls.filter(Boolean).map((url) => new URL(url).origin))];
}

export function resolveTrustProxy(env: NodeJS.ProcessEnv): number {
  if (env.TRUST_PROXY_HOPS?.trim()) {
    return Number(env.TRUST_PROXY_HOPS);
  }
  return env.NODE_ENV === 'production' ? PRODUCTION_PROXY_HOPS : 0;
}

function mountSwagger(app: NestExpressApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Home Broker API example')
    .setDescription('The Home Broker API description')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      'jwt',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('swagger/api', app, document);
}

export function configureApp(
  app: NestExpressApplication,
  env: NodeJS.ProcessEnv = process.env,
): void {
  app.set('trust proxy', resolveTrustProxy(env));
  app.use(helmet());
  // A request without an Origin header (server-to-server, like the frontend's
  // own server calls) is untouched; a browser origin must be listed.
  app.enableCors({ origin: resolveCorsOrigins(env) });
  app.useGlobalPipes(createValidationPipe());

  if (env.NODE_ENV !== 'production') {
    mountSwagger(app);
  }
}
