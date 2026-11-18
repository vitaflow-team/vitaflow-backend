const APP_ROUTE_PREFIX = '/restrict';

function isAppPath(path: string): boolean {
  if (path.startsWith('//')) return false;
  return (
    path === APP_ROUTE_PREFIX ||
    path.startsWith(`${APP_ROUTE_PREFIX}/`) ||
    path.startsWith(`${APP_ROUTE_PREFIX}?`)
  );
}

function stripOwnOrigin(link: string, appUrl: string | undefined): string {
  if (!appUrl) return link;
  const origin = appUrl.replace(/\/+$/, '');
  return link.startsWith(`${origin}/`) ? link.slice(origin.length) : link;
}

// Converts a stored notification link (absolute through APP_URL, or already
// relative) to an in-app path, or null when it does not point inside the
// restricted area (push-notifications ADR-007). Foreign hosts, protocol-
// relative URLs, and non-/restrict paths are rejected so the result is safe
// to redirect to.
export function normalizeNotificationLink(
  link: string | null | undefined,
  appUrl: string | undefined = process.env.APP_URL,
): string | null {
  if (!link) return null;
  const path = stripOwnOrigin(link.trim(), appUrl);
  return isAppPath(path) ? path : null;
}
