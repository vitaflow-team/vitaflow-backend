import { AssessmentValuesDTO } from './assessmentValues.Dto';

// An edit sends the whole set of values, exactly like creating one (without
// the declaration): optional values that are omitted are cleared.
export class UpdateAssessmentDTO extends AssessmentValuesDTO {}
