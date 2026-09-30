// A request behind AuthGuard that also exposes the caller's backoffice flag,
// for routes whose visibility rules differ for Vita Flow staff.
export interface BackofficeAwareRequest {
  user: { id: string; isBackoffice?: boolean };
}
