import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import { Clock } from '@/scheduling/clock.service';
import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  EducatorDashboardService,
  type EducatorDashboardSummary,
} from './educatorDashboard.service';

@ApiTags('Educator students — Dashboard')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, PhysicalEducatorGuard)
@Controller('educator/students/dashboard')
export class EducatorDashboardController {
  constructor(
    private readonly dashboard: EducatorDashboardService,
    private readonly clock: Clock,
  ) {}

  @ApiOperation({
    summary:
      'Portfolio counters, risk ranking, revenue-per-student series, and no-contact alerts',
  })
  @Get()
  async summary(
    @Request() req: AuthenticatedRequest,
  ): Promise<EducatorDashboardSummary> {
    return await this.dashboard.getDashboard(req.user.id, this.clock.now());
  }
}
