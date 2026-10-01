// Left to the implementer per the TechSpec ("exact ... message-length limit
// ... belong to the TechSpec", itself deferring the concrete number).
// 2000 chars comfortably covers a quick question or update — this is a
// support channel (ADR-001), not meant for long-form content.
export const MAX_MESSAGE_LENGTH = 2000;

// 20 sends/minute: generous for genuine back-and-forth chat while still
// bounding abuse, well above the 5/min used for pre-auth routes (which
// gate account-creation/login attempts, a different risk profile).
export const SEND_THROTTLE_LIMIT = 20;
export const SEND_THROTTLE_TTL_MS = 60_000;
