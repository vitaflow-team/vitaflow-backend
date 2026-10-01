import { AuthGuard } from '@/auth/auth.guard';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import { Body, Controller, Patch, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UpdateProfileDto } from './dto/updateProfile.Dto';
import { ProfessionalProfileEntity } from './professionalProfile.entity';
import { ProfessionalDiscoveryService } from './professionalDiscovery.service';

const PROFESSIONAL_ONLY_DESCRIPTION =
  'Apenas nutricionistas e educadores físicos podem acessar este recurso.';

@ApiTags('Professional Discovery')
@Controller('professionals')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, ProfessionalGuard)
export class ProfessionalProfileController {
  constructor(private readonly service: ProfessionalDiscoveryService) {}

  @ApiOperation({
    summary: 'Edit the authenticated professional’s own public profile',
  })
  @ApiResponse({ status: 200, type: ProfessionalProfileEntity })
  @ApiResponse({
    status: 400,
    description:
      'Content rejected: before/after imagery references or outcome-guarantee language (ADR-003).',
  })
  @ApiResponse({ status: 403, description: PROFESSIONAL_ONLY_DESCRIPTION })
  @Patch('me/profile')
  async updateOwnProfile(
    @Body() dto: UpdateProfileDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ProfessionalProfileEntity> {
    return await this.service.updateOwnProfile(req.user.id, dto);
  }
}
