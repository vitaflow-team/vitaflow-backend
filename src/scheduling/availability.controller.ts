import { AuthGuard } from '@/auth/auth.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
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
import { AvailabilityWindowEntity } from './availabilityWindow.entity';
import { PublishAvailabilityDto } from './dto/publishAvailability.Dto';
import { SchedulingService } from './scheduling.service';

@ApiTags('Scheduling')
@Controller('scheduling/availability')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, ProfessionalGuard)
export class AvailabilityController {
  constructor(private readonly service: SchedulingService) {}

  @ApiOperation({ summary: "The caller's own published availability windows" })
  @ApiResponse({ status: 200, type: [AvailabilityWindowEntity] })
  @Get()
  async list(
    @Request() req: AuthenticatedRequest,
  ): Promise<AvailabilityWindowEntity[]> {
    return await this.service.listAvailability(req.user.id);
  }

  @ApiOperation({
    summary:
      'Publish a recurring weekly availability window, generating bookable slots',
  })
  @ApiResponse({ status: 201, type: AvailabilityWindowEntity })
  @ApiResponse({ status: 400, description: 'Horário final antes do inicial.' })
  @Post()
  async publish(
    @Body() dto: PublishAvailabilityDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<AvailabilityWindowEntity> {
    return await this.service.publishAvailability(req.user.id, dto);
  }

  @ApiOperation({
    summary: 'Remove a window — only its future, still-open slots are deleted',
  })
  @ApiResponse({ status: 204, description: 'Sem corpo de resposta.' })
  @ApiResponse({ status: 404, description: 'Janela não encontrada.' })
  @HttpCode(204)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.removeAvailability(req.user.id, id);
  }
}
