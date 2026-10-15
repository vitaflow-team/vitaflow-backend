import { AuthGuard } from '@/auth/auth.guard';
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

@ApiTags('Academia — Receptionist Invitations')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
@Controller('academia-staff-invitations')
export class AcademiaStaffInvitationController {
  constructor(
    private readonly invitations: AcademiaInvitationService,
    private readonly users: UserRepository,
  ) {}

  @ApiOperation({
    summary: 'Pending receptionist invitations addressed to my email',
  })
  @Get('mine')
  async listMine(@Request() req: AuthenticatedRequest) {
    const user = await this.requireUser(req.user.id);
    return await this.invitations.listPendingReceptionistInvitations(
      user.email,
    );
  }

  @ApiOperation({ summary: 'Accept a pending receptionist invitation' })
  @ApiResponse({ status: 204, description: 'Sem corpo de resposta.' })
  @ApiResponse({
    status: 404,
    description: 'Convite não encontrado ou já respondido.',
  })
  @HttpCode(204)
  @Post(':id/accept')
  async accept(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    const user = await this.requireUser(req.user.id);
    await this.invitations.acceptReceptionistInvitation(
      id,
      user.name,
      user.email,
    );
  }

  @ApiOperation({ summary: 'Decline a pending receptionist invitation' })
  @ApiResponse({ status: 204, description: 'Sem corpo de resposta.' })
  @ApiResponse({
    status: 404,
    description: 'Convite não encontrado ou já respondido.',
  })
  @HttpCode(204)
  @Post(':id/decline')
  async decline(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    const user = await this.requireUser(req.user.id);
    await this.invitations.declineReceptionistInvitation(id, user.email);
  }

  private async requireUser(userId: string) {
    const user = await this.users.findUnique({ id: userId });
    if (!user) {
      throw new AppError('Unauthorized user.', 401);
    }
    return user;
  }
}
