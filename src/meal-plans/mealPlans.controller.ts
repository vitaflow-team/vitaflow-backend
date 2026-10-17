import { AuthGuard } from '@/auth/auth.guard';
import { CodedError } from '@/common/errors/codedError';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Weekday } from '@prisma/client';
import { CloneDayDTO } from './dto/cloneDay.Dto';
import {
  MealPlanDraftResponseDTO,
  MealPlanVersionResponseDTO,
} from './dto/mealPlanResponse.Dto';
import { SaveDayDTO } from './dto/saveDay.Dto';
import { MealPlansService } from './mealPlans.service';

const CLIENT_NOT_FOUND = 'Paciente não encontrado.';
const OVERWRITE_CONFIRMATION_REQUIRED =
  'Este dia já tem refeições. Confirme para sobrescrever.';

@ApiTags('Meal plans')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, ProfessionalGuard)
@Controller('professionals/clients/:clientId/meal-plan')
export class MealPlansController {
  constructor(
    private readonly mealPlans: MealPlansService,
    private readonly clients: ClientsRepository,
  ) {}

  @ApiOperation({ summary: 'Get-or-create the current draft' })
  @Get('draft')
  async getDraft(
    @Param('clientId') clientId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<MealPlanDraftResponseDTO> {
    await this.assertOwnedClient(req.user.id, clientId);
    return await this.mealPlans.getOrCreateDraft(clientId);
  }

  @ApiOperation({ summary: "Replace a day's meals on the current draft" })
  @Put('draft/days/:weekday')
  async saveDay(
    @Param('clientId') clientId: string,
    @Param('weekday') weekday: Weekday,
    @Body() dto: SaveDayDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<MealPlanDraftResponseDTO> {
    await this.assertOwnedClient(req.user.id, clientId);
    const draft = await this.mealPlans.getOrCreateDraft(clientId);
    return await this.mealPlans.saveDay(draft.id, {
      weekday,
      meals: dto.meals,
    });
  }

  @ApiOperation({
    summary:
      'Clone another day (current draft or a past published version) onto this one',
  })
  @ApiResponse({
    status: 409,
    description:
      'The target day already has meals; resend with `confirmOverwrite: true`.',
  })
  @Post('draft/days/:weekday/clone')
  async cloneDay(
    @Param('clientId') clientId: string,
    @Param('weekday') weekday: Weekday,
    @Body() dto: CloneDayDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<MealPlanDraftResponseDTO> {
    await this.assertOwnedClient(req.user.id, clientId);
    const draft = await this.mealPlans.getOrCreateDraft(clientId);

    const target = draft.days.find((day) => day.weekday === weekday);
    if (target && target.meals.length > 0 && dto.confirmOverwrite !== true) {
      throw new CodedError(
        OVERWRITE_CONFIRMATION_REQUIRED,
        409,
        'confirm_overwrite_required',
      );
    }

    return await this.mealPlans.cloneDay(draft.id, dto.sourceDayId, weekday);
  }

  @ApiOperation({ summary: 'Publish the current draft as a new version' })
  @ApiResponse({ status: 400, description: 'Empty plan (`empty_plan`).' })
  @Post('draft/publish')
  async publish(
    @Param('clientId') clientId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<MealPlanVersionResponseDTO> {
    await this.assertOwnedClient(req.user.id, clientId);
    const draft = await this.mealPlans.getOrCreateDraft(clientId);
    return await this.mealPlans.publish(draft.id);
  }

  @ApiOperation({ summary: "This patient's published version history" })
  @Get('versions')
  async listVersions(
    @Param('clientId') clientId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<MealPlanVersionResponseDTO[]> {
    await this.assertOwnedClient(req.user.id, clientId);
    return await this.mealPlans.listVersions(clientId);
  }

  @ApiOperation({ summary: "One published version's full content" })
  @Get('versions/:version')
  async getVersion(
    @Param('clientId') clientId: string,
    @Param('version', ParseIntPipe) version: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<MealPlanDraftResponseDTO> {
    await this.assertOwnedClient(req.user.id, clientId);
    return await this.mealPlans.getVersion(clientId, version);
  }

  private async assertOwnedClient(professionalId: string, clientId: string) {
    const client = await this.clients.findOwnedById(clientId, professionalId);
    if (!client) {
      throw new CodedError(CLIENT_NOT_FOUND, 404, 'client_not_found');
    }
    return client;
  }
}
