const REQUIRED_VARIABLES = [
  'JWT_SECRET',
  'DATABASE_URL',
  'APPLICATION_SECRET',
] as const;

function isPresent(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const variable of REQUIRED_VARIABLES) {
    if (!isPresent(env[variable])) {
      throw new Error(`Missing required environment variable: ${variable}`);
    }
  }

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
