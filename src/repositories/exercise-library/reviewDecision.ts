import { ExerciseStatus } from '@prisma/client';

export interface ReviewDecision {
  status: Exclude<ExerciseStatus, 'PENDING'>;
  reviewedById: string;
  rejectionReason?: string | null;
}
