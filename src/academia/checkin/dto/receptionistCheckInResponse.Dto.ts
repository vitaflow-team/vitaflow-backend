import type { CheckInNotice } from '../types/checkInNotice';

// The receptionist's check-in confirmation. Deliberately no other field: the
// notice is a flag, never a financial value (ADR-005).
export interface ReceptionistCheckInResponseDTO {
  id: string;
  createdAt: Date;
  notice: CheckInNotice | null;
}
