// What POST /auth/google/link carries: the Google ID token that proves who
// is at the Google side, and the intent that proves the signed-in owner
// asked for the link.
export interface GoogleLinkRequest {
  idToken: string;
  intent: string;
}
