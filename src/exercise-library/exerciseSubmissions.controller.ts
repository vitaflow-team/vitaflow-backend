import { AuthGuard } from '@/auth/auth.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ExerciseSubmitDto } from './dto/exerciseSubmit.Dto';
import { ExerciseEntity } from './exercise.entity';
import { ExerciseLibraryService } from './exerciseLibrary.service';

@ApiTags('Exercise submissions')
@Controller('exercises/submissions')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
export class ExerciseSubmissionsController {
  constructor(private readonly service: ExerciseLibraryService) {}

  @ApiOperation({
    summary: 'Submit a new exercise',
    description:
      'A physical educator proposes an exercise. It stays PENDING, hidden from the catalog, until backoffice review.',
  })
  @ApiBody({ type: ExerciseSubmitDto })
  @ApiResponse({
    status: 201,
    description: 'Submission created with PENDING status.',
    type: ExerciseEntity,
  })
  @ApiResponse({ status: 400, description: 'Invalid exercise data.' })
  @ApiResponse({ status: 401, description: 'Unauthorized access.' })
  @ApiResponse({
    status: 403,
    description: 'The caller is not a physical educator.',
  })
  @ApiResponse({
    status: 409,
    description: 'An identical submission is already awaiting review.',
  })
  @Post()
  async submit(
    @Body() body: ExerciseSubmitDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ExerciseEntity> {
    return await this.service.submit(body, req.user.id);
  }

  @ApiOperation({
    summary: 'List the caller own submissions',
    description:
      'Every exercise the educator submitted, with its current review status.',
  })
  @ApiResponse({
    status: 200,
    description: 'Submissions successfully retrieved.',
    type: [ExerciseEntity],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized access.' })
  @ApiResponse({
    status: 403,
    description: 'The caller is not a physical educator.',
  })
  @Get('mine')
  async listOwn(
    @Request() req: AuthenticatedRequest,
  ): Promise<ExerciseEntity[]> {
    return await this.service.listOwnSubmissions(req.user.id);
  }
}
