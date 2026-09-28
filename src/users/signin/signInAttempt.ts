// Mutable record of a password sign-in in progress, so the failure audit line
// can report why the attempt failed and for which account.
export type SignInAttempt = {
  failureReason: string;
  userId?: string;
};
