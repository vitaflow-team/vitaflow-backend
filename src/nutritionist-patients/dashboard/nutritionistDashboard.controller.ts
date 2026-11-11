import { AuthGuard } from '@/auth/auth.guard';
import { NutritionistGuard } from '@/common/guards/nutritionist.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import { Clock } from '@/scheduling/clock.service';
import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  NutritionistDashboardService,
  type NutritionistDashboardSummary,
} from './nutritionistDashboard.service';

@ApiTags('Nutritionist patients — Dashboard')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, NutritionistGuard)
@Controller('nutritionist/patients/dashboard')
export class NutritionistDashboardController {
  constructor(
    private readonly dashboard: NutritionistDashboardService,
    private readonly clock: Clock,
  ) {}

  @ApiOperation({
    summary:
      'Adherence buckets, no-diary-entry alerts, and portfolio weight evolution',
  })
  @Get()
  async summary(
    @Request() req: AuthenticatedRequest,
  ): Promise<NutritionistDashboardSummary> {
    return await this.dashboard.getDashboard(req.user.id, this.clock.now());
  }
}
