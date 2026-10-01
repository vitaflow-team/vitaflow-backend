import { AuthGuard } from '@/auth/auth.guard';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
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
import { ConnectionRequestEntity } from './connectionRequest.entity';
import { ProfessionalDiscoveryService } from './professionalDiscovery.service';

const PROFESSIONAL_ONLY_DESCRIPTION =
  'Apenas nutricionistas e educadores físicos podem acessar este recurso.';

@ApiTags('Professional Discovery')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
@Controller()
export class ConnectionRequestsController {
  constructor(private readonly service: ProfessionalDiscoveryService) {}

  @ApiOperation({ summary: 'Request to connect with a professional' })
  @ApiResponse({ status: 201, type: ConnectionRequestEntity })
  @ApiResponse({
    status: 409,
    description: 'Já existe uma solicitação pendente para este profissional.',
  })
  @Post('professionals/:id/connection-requests')
  async requestConnection(
    @Param('id') professionalId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<ConnectionRequestEntity> {
    return await this.service.requestConnection(req.user.id, professionalId);
  }

  @ApiOperation({
    summary: "The authenticated user's own requests and their status",
  })
  @ApiResponse({ status: 200, type: [ConnectionRequestEntity] })
  @Get('connection-requests/mine')
  async listOwn(
    @Request() req: AuthenticatedRequest,
  ): Promise<ConnectionRequestEntity[]> {
    return await this.service.listOwnRequests(req.user.id);
  }

  @ApiOperation({
    summary: "The authenticated professional's pending request queue",
  })
  @ApiResponse({ status: 200, type: [ConnectionRequestEntity] })
  @ApiResponse({ status: 403, description: PROFESSIONAL_ONLY_DESCRIPTION })
  @UseGuards(ProfessionalGuard)
  @Get('connection-requests/incoming')
  async listIncoming(
    @Request() req: AuthenticatedRequest,
  ): Promise<ConnectionRequestEntity[]> {
    return await this.service.listIncomingRequests(req.user.id);
  }

  @ApiOperation({ summary: 'Accept a pending request' })
  @ApiResponse({ status: 204, description: 'Sem corpo de resposta.' })
  @ApiResponse({
    status: 404,
    description: 'Solicitação não encontrada ou já respondida.',
  })
  @ApiResponse({ status: 403, description: PROFESSIONAL_ONLY_DESCRIPTION })
  @UseGuards(ProfessionalGuard)
  @HttpCode(204)
  @Post('connection-requests/:id/accept')
  async accept(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.accept(req.user.id, id);
  }

  @ApiOperation({ summary: 'Decline a pending request' })
  @ApiResponse({ status: 204, description: 'Sem corpo de resposta.' })
  @ApiResponse({
    status: 404,
    description: 'Solicitação não encontrada ou já respondida.',
  })
  @ApiResponse({ status: 403, description: PROFESSIONAL_ONLY_DESCRIPTION })
  @UseGuards(ProfessionalGuard)
  @HttpCode(204)
  @Post('connection-requests/:id/decline')
  async decline(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.decline(req.user.id, id);
  }
}
