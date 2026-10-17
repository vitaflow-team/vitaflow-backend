import { AuthGuard } from '@/auth/auth.guard';
import { NutritionistGuard } from '@/common/guards/nutritionist.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import {
  Body,
  Controller,
  Get,
  Param,
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
import { CreateNutritionistPatientDTO } from './dto/createNutritionistPatient.Dto';
import { ListNutritionistPatientsQueryDTO } from './dto/listNutritionistPatientsQuery.Dto';
import {
  NutritionistPatientListResponseDTO,
  NutritionistPatientResponseDTO,
} from './dto/nutritionistPatientResponse.Dto';
import { NutritionistPatientsService } from './nutritionistPatients.service';

@ApiTags('Nutritionist patients')
@Controller('nutritionist/patients')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, NutritionistGuard)
export class NutritionistPatientsController {
  constructor(private readonly service: NutritionistPatientsService) {}

  @ApiOperation({
    summary: "List/search the nutritionist's own patients",
    description: '`search` matches name or e-mail, ignoring case and accents.',
  })
  @ApiResponse({ status: 200, description: 'Patients listed.' })
  @Get()
  async list(
    @Query() query: ListNutritionistPatientsQueryDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<NutritionistPatientListResponseDTO> {
    return await this.service.list(req.user.id, query);
  }

  @ApiOperation({
    summary:
      'Register a patient, linking a matching confirmed account immediately',
  })
  @ApiResponse({ status: 201, description: 'Patient registered.' })
  @ApiResponse({
    status: 400,
    description: 'Missing name, or missing both phone and email.',
  })
  @ApiResponse({
    status: 409,
    description:
      'Already registered with this e-mail for this nutritionist (`duplicate_patient_email`).',
  })
  @Post()
  async create(
    @Body() dto: CreateNutritionistPatientDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<NutritionistPatientResponseDTO> {
    return await this.service.create(req.user.id, dto);
  }

  @ApiOperation({ summary: "A patient's record" })
  @ApiResponse({ status: 200, description: 'Patient found.' })
  @ApiResponse({ status: 404, description: 'Patient not found.' })
  @Get(':id')
  async get(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<NutritionistPatientResponseDTO> {
    return await this.service.get(req.user.id, id);
  }
}
