import { AuthGuard } from '@/auth/auth.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import { Meal } from '@prisma/client';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CompleteProfileDto } from './dto/completeProfile.Dto';
import { DateQueryDto } from './dto/dateQuery.Dto';
import { EstimateCaloriesDto } from './dto/estimateCalories.Dto';
import { LogMealDto } from './dto/logMeal.Dto';
import { UpdateMealDto } from './dto/updateMeal.Dto';
import { DailySummaryEntity, MealEntity } from './meal.entity';
import { FoodDiaryService } from './foodDiary.service';
import { DailySummary, MissingProfileField } from './foodDiary.types';

@ApiTags('Food Diary')
@Controller('food-diary')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
export class FoodDiaryController {
  constructor(private readonly service: FoodDiaryService) {}

  @ApiOperation({
    summary: "Estimate a meal's calories from a free-text description",
    description: 'Ephemeral — nothing is persisted by this call.',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({
    status: 503,
    description: 'Estimate unavailable; fall back to manual entry.',
  })
  @Post('estimate-calories')
  async estimateCalories(
    @Body() dto: EstimateCaloriesDto,
  ): Promise<{ calories: number }> {
    return await this.service.estimateCalories(dto.description);
  }

  @ApiOperation({ summary: 'Log a meal' })
  @ApiResponse({ status: 201, type: MealEntity })
  @Post('meals')
  async logMeal(
    @Body() dto: LogMealDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<Meal> {
    return await this.service.logMeal(req.user.id, dto);
  }

  @ApiOperation({ summary: 'Edit a logged meal' })
  @ApiResponse({ status: 200, type: MealEntity })
  @ApiResponse({
    status: 404,
    description: 'Não encontrada ou não pertence ao usuário.',
  })
  @Patch('meals/:id')
  async updateMeal(
    @Param('id') id: string,
    @Body() dto: UpdateMealDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<Meal> {
    return await this.service.updateMeal(req.user.id, id, dto);
  }

  @ApiOperation({ summary: 'Delete a logged meal' })
  @ApiResponse({ status: 204, description: 'Removida. Sem corpo de resposta.' })
  @ApiResponse({
    status: 404,
    description: 'Não encontrada ou não pertence ao usuário.',
  })
  @HttpCode(204)
  @Delete('meals/:id')
  async deleteMeal(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    return await this.service.deleteMeal(req.user.id, id);
  }

  @ApiOperation({ summary: "Get a day's meals, total, goal, water and streak" })
  @ApiResponse({ status: 200, type: DailySummaryEntity })
  @Get('summary')
  async getDailySummary(
    @Query() query: DateQueryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<DailySummary> {
    return await this.service.getDailySummary(req.user.id, query.date);
  }

  @ApiOperation({ summary: "Increment a day's water count by one" })
  @ApiResponse({ status: 201 })
  @Post('water')
  async incrementWater(
    @Query() query: DateQueryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<{ count: number }> {
    return await this.service.incrementWater(req.user.id, query.date);
  }

  @ApiOperation({
    summary: "Decrement a day's water count by one",
    description: 'Never goes below 0.',
  })
  @ApiResponse({ status: 200 })
  @Delete('water')
  async decrementWater(
    @Query() query: DateQueryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<{ count: number }> {
    return await this.service.decrementWater(req.user.id, query.date);
  }

  @ApiOperation({
    summary: 'Which FitnessProfile fields are still missing',
    description: 'Drives the first-time profile-completion prompt (US-005).',
  })
  @ApiResponse({ status: 200 })
  @Get('profile-status')
  async getProfileStatus(
    @Request() req: AuthenticatedRequest,
  ): Promise<{ missingFields: MissingProfileField[] }> {
    const missingFields = await this.service.getMissingProfileFields(
      req.user.id,
    );
    return { missingFields };
  }

  @ApiOperation({
    summary: "Submit the diary's own profile-completion prompt",
    description:
      'Writes sex/goal to the shared FitnessProfile and weight/height to a real MeasurementRecord — never a diary-local field.',
  })
  @ApiResponse({ status: 204, description: 'Sem corpo de resposta.' })
  @HttpCode(204)
  @Post('profile')
  async completeProfile(
    @Body() dto: CompleteProfileDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    return await this.service.completeProfile(req.user.id, dto);
  }
}
