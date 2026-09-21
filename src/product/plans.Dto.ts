import { IsIn, IsOptional } from 'class-validator';
import { PLAN_CATEGORIES } from './planCategory';
import type { PlanCategory } from './planCategory';

export class PlansQueryDTO {
  // Only the three exact names are accepted: a different case, an empty
  // value or a repeated parameter (which Express hands over as an array)
  // all fail `IsIn` and come back as a 400 from the global ValidationPipe
  // instead of reaching the repository.
  @IsOptional()
  @IsIn(PLAN_CATEGORIES as unknown as string[])
  category?: PlanCategory;
}
