import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
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
import { AssessmentsService } from './assessments.service';
import { AssessmentListResponseDTO } from './dto/assessmentList.Dto';
import { AssessmentResponseDTO } from './dto/assessmentResponse.Dto';
import { CreateAssessmentDTO } from './dto/createAssessment.Dto';
import { ListAssessmentsQueryDTO } from './dto/listAssessmentsQuery.Dto';
import { UpdateAssessmentDTO } from './dto/updateAssessment.Dto';

@ApiTags('Educator assessments')
@Controller('educator/students/:studentId/assessments')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, PhysicalEducatorGuard)
export class AssessmentsController {
  constructor(private readonly service: AssessmentsService) {}

  @ApiOperation({
    summary: "A student's assessments, newest first, with the variation",
  })
  @ApiResponse({ status: 200, description: 'Assessments listed.' })
  @ApiResponse({ status: 404, description: 'Student not found.' })
  @Get()
  async list(
    @Param('studentId') studentId: string,
    @Query() query: ListAssessmentsQueryDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<AssessmentListResponseDTO> {
    return await this.service.list(req.user.id, studentId, query.page);
  }

  @ApiOperation({
    summary: 'Register an assessment',
    description:
      'Needs the educator’s health-data declaration on record: send `acceptDeclaration: true` with the first assessment.',
  })
  @ApiResponse({ status: 201, description: 'Assessment saved.' })
  @ApiResponse({ status: 400, description: 'Invalid values.' })
  @ApiResponse({
    status: 403,
    description: 'The declaration was not accepted (`declaration_required`).',
  })
  @ApiResponse({ status: 404, description: 'Student not found.' })
  @Post()
  async create(
    @Param('studentId') studentId: string,
    @Body() dto: CreateAssessmentDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<AssessmentResponseDTO> {
    return await this.service.create(req.user.id, studentId, dto);
  }

  @ApiOperation({
    summary:
      'Edit an assessment (the whole set of values replaces the stored one)',
  })
  @ApiResponse({ status: 200, description: 'Assessment updated.' })
  @ApiResponse({ status: 400, description: 'Invalid values.' })
  @ApiResponse({ status: 404, description: 'Student or assessment not found.' })
  @Patch(':assessmentId')
  async update(
    @Param('studentId') studentId: string,
    @Param('assessmentId') assessmentId: string,
    @Body() dto: UpdateAssessmentDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<AssessmentResponseDTO> {
    return await this.service.update(req.user.id, studentId, assessmentId, dto);
  }

  @ApiOperation({ summary: 'Delete an assessment' })
  @ApiResponse({ status: 204, description: 'Assessment deleted.' })
  @ApiResponse({ status: 404, description: 'Student or assessment not found.' })
  @HttpCode(204)
  @Delete(':assessmentId')
  async remove(
    @Param('studentId') studentId: string,
    @Param('assessmentId') assessmentId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.remove(req.user.id, studentId, assessmentId);
  }
}
