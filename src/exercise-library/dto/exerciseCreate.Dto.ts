import { ExerciseSubmitDto } from './exerciseSubmit.Dto';

// A backoffice direct create takes the same fields as an educator
// submission; only the resulting status differs (APPROVED, set by the
// service).
export class ExerciseCreateDto extends ExerciseSubmitDto {}
