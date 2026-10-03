import type {
  AssessmentResponseDTO,
  AssessmentVariationDTO,
} from './assessmentResponse.Dto';

// Response shapes only: plain interfaces, never validated at runtime.
export interface AssessmentListResponseDTO {
  items: AssessmentResponseDTO[];
  total: number;
  page: number;
  pageSize: number;
  /** Over all of the student's assessments, not only the page. */
  variation: AssessmentVariationDTO | null;
}

export interface DeclarationStatusDTO {
  accepted: boolean;
}
