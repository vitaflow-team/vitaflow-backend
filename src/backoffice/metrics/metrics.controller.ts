import { AuthGuard } from '@/auth/auth.guard';
import { AdminTierGuard } from '@/common/guards/adminTier.guard';
import { BackofficeGuard } from '@/common/guards/backoffice.guard';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformMetricsResponseDTO } from './dto/platformMetrics.Dto';
import { MetricsService } from './metrics.service';

@ApiTags('Backoffice platform metrics')
@ApiBearerAuth('jwt')
@Controller('backoffice/metrics')
@UseGuards(AuthGuard, BackofficeGuard, AdminTierGuard)
export class MetricsController {
  constructor(private readonly service: MetricsService) {}

  @ApiOperation({
    summary:
      'Current MRR, registered users by role/plan and churn by role, admin-interno-only',
  })
  @Get()
  async get(): Promise<PlatformMetricsResponseDTO> {
    return await this.service.getPlatformMetrics();
  }
}
