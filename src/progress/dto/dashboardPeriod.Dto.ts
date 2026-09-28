import { ApiProperty } from '@nestjs/swagger';
import { DASHBOARD_WEEKS } from '../dashboardWeeks';
import type { DashboardWeeks } from '../dashboardWeeks';

export class DashboardPeriodDTO {
  @ApiProperty({ enum: DASHBOARD_WEEKS, example: 8 })
  weeks: DashboardWeeks;

  @ApiProperty({ example: '2025-11-20T10:00:00.000Z' })
  start: string;

  @ApiProperty({ example: '2026-01-15T10:00:00.000Z' })
  end: string;
}
