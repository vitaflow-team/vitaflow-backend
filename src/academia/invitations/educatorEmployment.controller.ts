import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AcademiaInvitationService } from './academiaInvitation.service';
import { EmploymentService } from './employment.service';

const EDUCATOR_ONLY = 'Apenas educadores físicos podem acessar este recurso.';

@ApiTags('Academia — Educator')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, PhysicalEducatorGuard)
@Controller('educators/me')
export class EducatorEmploymentController {
  constructor(
    private readonly invitations: AcademiaInvitationService,
    private readonly employments: EmploymentService,
    private readonly users: UserRepository,
  ) {}

  @ApiOperation({
    summary: 'Pending employment invitations addressed to me',
  })
  @ApiResponse({ status: 403, description: EDUCATOR_ONLY })
  @Get('academia-invitations')
  async listPending(@Request() req: AuthenticatedRequest) {
    const email = await this.requireEmail(req.user.id);
    return await this.invitations.listPendingForEducator(req.user.id, email);
  }

  @ApiOperation({ summary: 'Accept a pending employment invitation' })
  @ApiResponse({ status: 204, description: 'Sem corpo de resposta.' })
  @ApiResponse({
    status: 404,
    description: 'Convite não encontrado ou já respondido.',
  })
  @HttpCode(204)
  @Post('academia-invitations/:id/accept')
  async accept(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    const email = await this.requireEmail(req.user.id);
    await this.invitations.accept(id, req.user.id, email);
  }

  @ApiOperation({ summary: 'Decline a pending employment invitation' })
  @ApiResponse({ status: 204, description: 'Sem corpo de resposta.' })
  @ApiResponse({
    status: 404,
    description: 'Convite não encontrado ou já respondido.',
  })
  @HttpCode(204)
  @Post('academia-invitations/:id/decline')
  async decline(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    const email = await this.requireEmail(req.user.id);
    await this.invitations.decline(id, req.user.id, email);
  }

  @ApiOperation({ summary: 'Academias currently employing me' })
  @Get('employments')
  async listEmployments(@Request() req: AuthenticatedRequest) {
    return await this.employments.listActiveByEducator(req.user.id);
  }

  private async requireEmail(userId: string): Promise<string> {
    const user = await this.users.findUnique({ id: userId });
    if (!user) {
      throw new AppError('Unauthorized user.', 401);
    }
    return user.email;
  }
}
