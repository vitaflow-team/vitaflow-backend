import { AuthGuard } from '@/auth/auth.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  EducatorMirrorEntity,
  NoProfessionalEntity,
  NutritionistMirrorEntity,
} from './professionalMirror.entity';
import { ProfessionalMirrorService } from './professionalMirror.service';

@ApiTags('Professional Mirror')
@Controller('me')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
export class ProfessionalMirrorController {
  constructor(private readonly service: ProfessionalMirrorService) {}

  @ApiOperation({
    summary:
      'Read-only mirror of the linked nutritionist (identity plus the fixed, mostly-null contract)',
  })
  @ApiResponse({
    status: 200,
    description:
      '`NutritionistMirrorEntity` when linked, `NoProfessionalEntity` ({ hasProfessional: false }) otherwise.',
  })
  @Get('nutritionist')
  async getNutritionistMirror(
    @Request() req: AuthenticatedRequest,
  ): Promise<NutritionistMirrorEntity | NoProfessionalEntity> {
    return await this.service.getNutritionistMirror(req.user.id);
  }

  @ApiOperation({
    summary:
      'Read-only mirror of the linked physical educator (identity plus the fixed, mostly-null contract)',
  })
  @ApiResponse({
    status: 200,
    description:
      '`EducatorMirrorEntity` when linked, `NoProfessionalEntity` ({ hasProfessional: false }) otherwise.',
  })
  @Get('physical-educator')
  async getEducatorMirror(
    @Request() req: AuthenticatedRequest,
  ): Promise<EducatorMirrorEntity | NoProfessionalEntity> {
    return await this.service.getEducatorMirror(req.user.id);
  }
}
