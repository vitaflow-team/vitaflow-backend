// The request as seen by a route behind AuthGuard: the guard has already
// resolved the caller, so `user.id` is the only trusted user identifier.
export interface AuthenticatedRequest {
  user: { id: string };
}
