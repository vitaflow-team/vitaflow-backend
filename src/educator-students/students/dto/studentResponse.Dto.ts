import type { FormRecordResponseDTO } from '@/clinical-records/records/dto/formRecordResponse.Dto';
import type { FinancialSituation } from '@/billing/shared/invoiceTransitions';
import type { BillingWarningDTO } from '@/billing/invoices/invoices.service';
import type { StudentWeightVariation } from '../studentWeightVariation.util';

// Response shapes only: plain interfaces, never validated at runtime.
export interface NextSessionDTO {
  startAt: Date;
  type: 'PRESENCIAL' | 'ONLINE';
}

export interface StudentListItemDTO {
  id: string;
  name: string;
  email: string;
  hasAccount: boolean;
  /** The next scheduled fixed session or booking with this educator, or null. */
  nextSession: NextSessionDTO | null;
  /** `YYYY-MM-DD`, or null when the student has no assessment yet. */
  lastAssessedOn: string | null;
  /** `null` for a professional who is not Premium. */
  financialSituation: FinancialSituation | null;
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
  /** The next scheduled fixed session or booking with this educator, or null. */
  nextSession: NextSessionDTO | null;
  latest: FormRecordResponseDTO | null;
  variation: StudentWeightVariation | null;
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
  /** `null` for a professional who is not Premium. */
  financialSituation: FinancialSituation | null;
}

export interface RemoveStudentResponseDTO {
  /** Competences whose charge could not be canceled at the gateway. */
  billingWarnings: BillingWarningDTO[];
}

export interface AccountLookupResponseDTO {
  found: boolean;
  /** The account holder's name, shown only so the educator can confirm who it is. */
  name: string | null;
}
