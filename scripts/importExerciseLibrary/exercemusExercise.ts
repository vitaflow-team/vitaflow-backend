import { ExercemusLicense } from './exercemusLicense';

// One entry of exercemus/exercises `exercises.json`, as documented in the
// upstream README (field names kept in the dataset's snake_case).
export interface ExercemusExercise {
  name: string;
  category: string;
  description?: string;
  instructions: string[];
  equipment: string[];
  primary_muscles: string[];
  secondary_muscles: string[];
  images?: string[];
  video?: string;
  license?: ExercemusLicense;
  license_author?: string;
}
