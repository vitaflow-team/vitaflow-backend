import type { ActivationSkip } from '../types/activationSkip';

export interface ActivationResultResponseDTO {
  activated: string[];
  skipped: ActivationSkip[];
}
