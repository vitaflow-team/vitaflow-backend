import { AuthGuard } from '@/auth/auth.guard';
import { AdminTierGuard } from '@/common/guards/adminTier.guard';
import { BackofficeGuard } from '@/common/guards/backoffice.guard';
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ErrorMonitoringDetailParamsDTO } from './dto/errorMonitoringDetailParams.Dto';
import {
  ErrorMonitoringListResult,
  ErrorMonitoringService,
} from './errorMonitoring.service';
import { SentryIssueDetail } from './gateway/sentry/sentryGateway';

@ApiTags('Backoffice error monitoring')
@ApiBearerAuth('jwt')
@Controller('backoffice/error-monitoring')
@UseGuards(AuthGuard, BackofficeGuard, AdminTierGuard)
export class ErrorMonitoringController {
  constructor(private readonly service: ErrorMonitoringService) {}

  @ApiOperation({
    summary:
      'List unresolved Sentry issues across both apps, admin-interno-only',
  })
  @Get()
  async list(): Promise<ErrorMonitoringListResult> {
    return await this.service.list();
  }

  @ApiOperation({
    summary: 'Detail (with stack trace) for one Sentry issue',
  })
  @Get(':app/:issueId')
  async detail(
    @Param() params: ErrorMonitoringDetailParamsDTO,
  ): Promise<SentryIssueDetail> {
    return await this.service.detail(params.app, params.issueId);
  }
}
