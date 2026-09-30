const REQUIRED_VARIABLES = [
  'JWT_SECRET',
  'DATABASE_URL',
  'APPLICATION_SECRET',
  'STRIPE_API_KEY',
  'OPENAI_API_KEY',
  'APP_URL',
  'GCP_PROJECT_ID',
  'GCP_CLIENT_EMAIL',
  'GCP_PRIVATE_KEY',
  'GCP_BUCKET',
  'MAIL_HOST',
  'MAIL_PORT',
  'MAIL_USER',
  'MAIL_PASS',
] as const;

export const JWT_SECRET_MIN_LENGTH = 32;

function isPresent(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isHttpUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function assertRequiredVariables(env: NodeJS.ProcessEnv): void {
  for (const variable of REQUIRED_VARIABLES) {
    if (!isPresent(env[variable])) {
      throw new Error(`Missing required environment variable: ${variable}`);
    }
  }
}

function assertGoogleCredentialsPaired(env: NodeJS.ProcessEnv): void {
  const hasGoogleClientId = isPresent(env.GOOGLE_CLIENT_ID);
  const hasGoogleClientSecret = isPresent(env.GOOGLE_CLIENT_SECRET);

  if (hasGoogleClientId !== hasGoogleClientSecret) {
    const missingVariable = hasGoogleClientId
      ? 'GOOGLE_CLIENT_SECRET'
      : 'GOOGLE_CLIENT_ID';
    throw new Error(
      `Missing required environment variable: ${missingVariable}`,
    );
  }
}

// Values are never echoed: the message names the variable and the rule only.
function assertWellFormed(env: NodeJS.ProcessEnv): void {
  if (env.JWT_SECRET!.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(
      `Invalid environment variable: JWT_SECRET must be at least ${JWT_SECRET_MIN_LENGTH} characters`,
    );
  }

  const urls = [env.APP_URL!, ...splitList(env.CORS_ALLOWED_ORIGINS)];
  if (!urls.every(isHttpUrl)) {
    throw new Error(
      'Invalid environment variable: APP_URL and CORS_ALLOWED_ORIGINS must be absolute http(s) URLs',
    );
  }

  if (isPresent(env.TRUST_PROXY_HOPS) && !/^\d+$/.test(env.TRUST_PROXY_HOPS!)) {
    throw new Error(
      'Invalid environment variable: TRUST_PROXY_HOPS must be a non-negative integer',
    );
  }
}

export function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
  assertRequiredVariables(env);
  assertGoogleCredentialsPaired(env);
  assertWellFormed(env);
}
