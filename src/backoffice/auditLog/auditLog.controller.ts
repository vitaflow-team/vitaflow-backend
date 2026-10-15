import { AuthGuard } from '@/auth/auth.guard';
import { AdminTierGuard } from '@/common/guards/adminTier.guard';
import { BackofficeGuard } from '@/common/guards/backoffice.guard';
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditLogListResult, AuditLogService } from './auditLog.service';
import { ListAuditLogQueryDTO } from './dto/listAuditLog.Dto';

@ApiTags('Backoffice audit log')
@ApiBearerAuth('jwt')
@Controller('backoffice/audit-log')
@UseGuards(AuthGuard, BackofficeGuard, AdminTierGuard)
export class AuditLogController {
  constructor(private readonly service: AuditLogService) {}

  @ApiOperation({
    summary: 'Read every "ver como" session, admin-interno-only (US-011)',
  })
  @Get()
  async list(
    @Query() query: ListAuditLogQueryDTO,
  ): Promise<AuditLogListResult> {
    return await this.service.list(
      { staffId: query.staffId, targetId: query.targetId },
      query.page ?? 1,
    );
  }
}
