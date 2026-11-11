import { AuthGuard } from '@/auth/auth.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AcademiaMembershipEntity } from './academiaMirror.entity';
import { AcademiaMirrorService } from './academiaMirror.service';

@ApiTags('Academia Mirror')
@Controller('me/academia')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
export class AcademiaMirrorController {
  constructor(private readonly service: AcademiaMirrorService) {}

  @ApiOperation({
    summary:
      'Read-only list of every gym membership the caller holds, each with current access-plan status and plan history.',
  })
  @ApiResponse({
    status: 200,
    type: [AcademiaMembershipEntity],
    description: 'An empty array when the caller has no gym membership.',
  })
  @Get()
  async getMemberships(
    @Request() req: AuthenticatedRequest,
  ): Promise<AcademiaMembershipEntity[]> {
    return await this.service.getMemberships(req.user.id);
  }
}
