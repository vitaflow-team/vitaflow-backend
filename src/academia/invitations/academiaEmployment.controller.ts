import { AcademiaOwnerGuard } from '@/common/guards/academiaOwner.guard';
import { AuthGuard } from '@/auth/auth.guard';
import type { AcademiaOwnerRequest } from '@/common/types/academiaOwnerRequest';
import {
  Body,
  Controller,
  Delete,
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
import { InviteAcademiaMemberDTO } from './dto/inviteAcademiaMember.Dto';

@ApiTags('Academia — Employment')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, AcademiaOwnerGuard)
@Controller('academia')
export class AcademiaEmploymentController {
  constructor(
    private readonly invitations: AcademiaInvitationService,
    private readonly employments: EmploymentService,
  ) {}

  @ApiOperation({ summary: 'Invite an educator or a receptionist by email' })
  @ApiResponse({ status: 201, description: 'Invitation created.' })
  @ApiResponse({
    status: 409,
    description:
      'An invitation is already pending for this email, or this educator is already employed.',
  })
  @ApiResponse({
    status: 400,
    description:
      'The email belongs to an account that is not a physical educator (EMPLOYMENT only).',
  })
  @Post('invitations')
  async invite(
    @Body() dto: InviteAcademiaMemberDTO,
    @Request() req: AcademiaOwnerRequest,
  ) {
    return await this.invitations.invite(
      req.user.academiaId,
      dto.email,
      dto.kind,
    );
  }

  @ApiOperation({ summary: 'Cancel a pending invitation this academia sent' })
  @ApiResponse({ status: 204, description: 'Sem corpo de resposta.' })
  @ApiResponse({
    status: 404,
    description: 'Convite não encontrado ou já respondido.',
  })
  @HttpCode(204)
  @Post('invitations/:id/cancel')
  async cancel(
    @Param('id') id: string,
    @Request() req: AcademiaOwnerRequest,
  ): Promise<void> {
    await this.invitations.cancel(id, req.user.academiaId);
  }

  @ApiOperation({ summary: 'Active employments at this academia' })
  @Get('educators')
  async listEducators(@Request() req: AcademiaOwnerRequest) {
    return await this.employments.listActiveByAcademia(req.user.academiaId);
  }

  @ApiOperation({ summary: 'End an employment' })
  @ApiResponse({ status: 204, description: 'Sem corpo de resposta.' })
  @ApiResponse({
    status: 404,
    description: 'Vínculo não encontrado ou já encerrado.',
  })
  @HttpCode(204)
  @Delete('employments/:id')
  async endEmployment(
    @Param('id') id: string,
    @Request() req: AcademiaOwnerRequest,
  ): Promise<void> {
    await this.employments.end(req.user.academiaId, id);
  }
}
