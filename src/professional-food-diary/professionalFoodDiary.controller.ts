import { AuthGuard } from '@/auth/auth.guard';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import { Controller, Get, Param, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ProfessionalFoodDiaryResponseDTO } from './dto/professionalFoodDiaryResponse.Dto';
import { ProfessionalFoodDiaryService } from './professionalFoodDiary.service';

@ApiTags('Professional food-diary reads')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, ProfessionalGuard)
@Controller('professionals/clients/:clientId/food-diary')
export class ProfessionalFoodDiaryController {
  constructor(private readonly service: ProfessionalFoodDiaryService) {}

  @ApiOperation({
    summary: "A linked patient's food-diary history — read-only",
    description:
      'Empty-but-valid (never an error) when the Client has no linked account or simply has no entries yet.',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: "Not this caller's patient." })
  @Get()
  async getDiary(
    @Param('clientId') clientId: string,
    @Request() req: AuthenticatedRequest & { user: { academiaId?: string } },
  ): Promise<ProfessionalFoodDiaryResponseDTO> {
    return await this.service.getDiary(
      req.user.id,
      req.user.academiaId ?? undefined,
      clientId,
    );
  }
}
