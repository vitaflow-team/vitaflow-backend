import { AuthGuard } from '@/auth/auth.guard';
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ProfessionalSearchDto } from './dto/professionalSearch.Dto';
import {
  ProfessionalProfileEntity,
  ProfessionalSummaryEntity,
} from './professionalProfile.entity';
import { ProfessionalDiscoveryService } from './professionalDiscovery.service';

@ApiTags('Professional Discovery')
@Controller('professionals')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
export class ProfessionalSearchController {
  constructor(private readonly service: ProfessionalDiscoveryService) {}

  @ApiOperation({
    summary:
      'Search professionals by type, specialty, price, and online availability',
  })
  @ApiResponse({ status: 200, type: [ProfessionalSummaryEntity] })
  @Get()
  async search(
    @Query() query: ProfessionalSearchDto,
  ): Promise<ProfessionalSummaryEntity[]> {
    return await this.service.search(query);
  }

  @ApiOperation({ summary: "A professional's public profile" })
  @ApiResponse({ status: 200, type: ProfessionalProfileEntity })
  @ApiResponse({ status: 404, description: 'Profissional não encontrado.' })
  @Get(':id')
  async getProfile(
    @Param('id') id: string,
  ): Promise<ProfessionalProfileEntity> {
    return await this.service.getProfile(id);
  }
}
