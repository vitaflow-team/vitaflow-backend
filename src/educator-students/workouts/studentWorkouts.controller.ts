import { AuthGuard } from '@/auth/auth.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { StudentWorkoutsResponseDTO } from './dto/studentWorkout.Dto';
import { StudentWorkoutsService } from './studentWorkouts.service';

@ApiTags('Educator workouts (student)')
@Controller('me/educator-workouts')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
export class StudentWorkoutsController {
  constructor(private readonly service: StudentWorkoutsService) {}

  @ApiOperation({
    summary: 'The active workouts my educators built for me (read-only)',
  })
  @ApiResponse({ status: 200, description: 'Active workouts, possibly none.' })
  @ApiResponse({ status: 401, description: 'Unauthorized access.' })
  @Get()
  async getActive(
    @Request() req: AuthenticatedRequest,
  ): Promise<StudentWorkoutsResponseDTO> {
    return await this.service.getActiveForUser(req.user.id);
  }
}
