import { Transform, TransformFnParams } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { DASHBOARD_WEEKS } from '../dashboardWeeks';
import type { DashboardWeeks } from '../dashboardWeeks';

export class DashboardQueryDTO {
  @IsOptional()
  @Transform(({ value }: TransformFnParams) => {
    const queryValue = value as unknown;
    return typeof queryValue === 'string' && /^\d+$/.test(queryValue)
      ? Number(queryValue)
      : queryValue;
  })
  @IsIn(DASHBOARD_WEEKS as unknown as number[])
  weeks?: DashboardWeeks;
}
