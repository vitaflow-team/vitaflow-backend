import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AssessmentsService } from './assessments.service';
import { DeclarationStatusDTO } from './dto/assessmentList.Dto';

@ApiTags('Educator assessments')
@Controller('educator/assessment-declaration')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, PhysicalEducatorGuard)
export class DeclarationController {
  constructor(private readonly service: AssessmentsService) {}

  @ApiOperation({
    summary:
      'Whether the educator already accepted the health-data declaration',
  })
  @ApiResponse({ status: 200, description: '`{ accepted }`.' })
  @Get()
  async status(
    @Request() req: AuthenticatedRequest,
  ): Promise<DeclarationStatusDTO> {
    return await this.service.declarationStatus(req.user.id);
  }
}
