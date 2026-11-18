import type { ActivationSkipReason } from './activationSkipReason';

export interface ActivationSkip {
  clientId: string;
  reason: ActivationSkipReason;
}
