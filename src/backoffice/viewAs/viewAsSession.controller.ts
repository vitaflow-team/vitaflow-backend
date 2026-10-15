import { AuthGuard } from '@/auth/auth.guard';
import { AllowDuringViewAs } from '@/common/decorators/allowDuringViewAs.decorator';
import { BackofficeGuard } from '@/common/guards/backoffice.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StartViewAsDTO } from './dto/startViewAs.Dto';
import {
  StartViewAsResult,
  ViewAsSessionService,
} from './viewAsSession.service';

@ApiTags('Backoffice ver-como')
@ApiBearerAuth('jwt')
@Controller('backoffice/view-as-sessions')
@UseGuards(AuthGuard, BackofficeGuard)
export class ViewAsSessionController {
  constructor(private readonly service: ViewAsSessionService) {}

  @ApiOperation({ summary: 'Start a "ver como" session (US-003)' })
  @HttpCode(201)
  @Post()
  async start(
    @Body() body: StartViewAsDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<StartViewAsResult> {
    return await this.service.start({
      staffUserId: req.user.id,
      targetKind: body.targetKind,
      targetId: body.targetId,
      reason: body.reason,
    });
  }

  @ApiOperation({
    summary:
      'End a "ver como" session — own, or anyone\'s if admin interno (US-006)',
  })
  @AllowDuringViewAs()
  @HttpCode(200)
  @Post(':id/end')
  async end(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<{ ok: true }> {
    await this.service.end(id, req.user.id);
    return { ok: true };
  }
}
