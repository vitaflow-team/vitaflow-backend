import { SetMetadata } from '@nestjs/common';

export const ALLOW_DURING_VIEW_AS = 'allowDuringViewAs';

// Marks the one mutating endpoint ViewAsWriteBlockGuard must let through
// despite the deny-by-default rule: ending the "ver como" session itself
// (platform-admin-access ADR-004). Matched by handler/class metadata, never
// by guessing at a route's path string.
export const AllowDuringViewAs = () => SetMetadata(ALLOW_DURING_VIEW_AS, true);
