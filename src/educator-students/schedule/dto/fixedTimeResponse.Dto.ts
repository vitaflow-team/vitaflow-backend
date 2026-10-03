import { SessionType } from '@prisma/client';

export interface FixedTimeResponseDTO {
  id: string;
  weekday: number;
  startMinute: number;
  durationMinutes: number;
  type: SessionType;
  onlineLink: string | null;
  workoutLetter: string | null;
  /** The session name the letter resolves to, or null. */
  workoutSessionName: string | null;
  /** True when the letter names a session the active workout does not have. */
  workoutMissing: boolean;
}

export interface UpcomingScheduleItemDTO {
  id: string;
  source: 'FIXED' | 'BOOKING';
  startAt: Date;
  endAt: Date;
  type: SessionType;
  onlineLink: string | null;
  status: 'SCHEDULED' | 'CANCELED' | 'BOOKED';
  workoutLetter: string | null;
  workoutSessionName: string | null;
}

export interface StudentScheduleResponseDTO {
  fixedTimes: FixedTimeResponseDTO[];
  upcoming: UpcomingScheduleItemDTO[];
}
