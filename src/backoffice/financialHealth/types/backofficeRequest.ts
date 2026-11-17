import type { BackofficeStaff } from './backofficeStaff';

// The request behind AuthGuard and BackofficeGuard: the user row is loaded
// fresh on every request, so the tier is never older than the request.
export interface BackofficeRequest {
  user: BackofficeStaff;
}
