import type {
  AssessmentResponseDTO,
  AssessmentVariationDTO,
} from '../../assessments/dto/assessmentResponse.Dto';

// Response shapes only: plain interfaces, never validated at runtime.
export interface StudentListItemDTO {
  id: string;
  name: string;
  email: string;
  hasAccount: boolean;
  /** `YYYY-MM-DD`, or null when the student has no assessment yet. */
  lastAssessedOn: string | null;
}

export interface StudentListResponseDTO {
  items: StudentListItemDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CurrentWorkoutDTO {
  id: string;
  title: string;
  weeklyFrequency: number | null;
  sessionNames: string[];
}

export interface StudentOverviewDTO {
  latest: AssessmentResponseDTO | null;
  variation: AssessmentVariationDTO | null;
  /** The educator's active workout for this student, or null. */
  currentWorkout: CurrentWorkoutDTO | null;
}

export interface StudentResponseDTO {
  id: string;
  name: string;
  email: string;
  phone: string;
  /** `YYYY-MM-DD`, or null. */
  birthDate: string | null;
  hasAccount: boolean;
  /** The linked account id (the key of the messages route), or null without an account. */
  userId: string | null;
  createdAt: string;
  overview: StudentOverviewDTO;
}

export interface AccountLookupResponseDTO {
  found: boolean;
  /** The account holder's name, shown only so the educator can confirm who it is. */
  name: string | null;
}
