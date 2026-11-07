import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Request,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GeneratedPdf } from './pdfExport.types';
import { PdfExportService } from './pdfExport.service';

// 8 routes (TechSpec: API Endpoints), split across 7 controller classes in
// this one file — each class keeps a single guard stack
// (vitaflow-backend-conventions §2), mirroring the exact `@Controller()`
// base path of the view endpoint it exports, with `/pdf` appended at the
// leaf. Every route delegates to exactly one PdfExportService method and
// wraps the result in a StreamableFile with the dynamic
// Content-Type/Content-Disposition the service's filename implies
// (ADR-011).
function toPdfResponse(pdf: GeneratedPdf): StreamableFile {
  return new StreamableFile(pdf.buffer, {
    type: 'application/pdf',
    disposition: `attachment; filename="${pdf.filename}"`,
  });
}

@ApiTags('PDF export — Meal plan (professional)')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, ProfessionalGuard)
@Controller('professionals/clients/:clientId/meal-plan')
export class MealPlanPdfController {
  constructor(private readonly service: PdfExportService) {}

  @ApiOperation({ summary: 'Export the current draft as a PDF' })
  @ApiResponse({ status: 200, description: 'application/pdf' })
  @Get('draft/pdf')
  async exportDraft(
    @Param('clientId') clientId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<StreamableFile> {
    const pdf = await this.service.exportMealPlanDraft(clientId, req.user.id);
    return toPdfResponse(pdf);
  }

  @ApiOperation({ summary: 'Export one published version as a PDF' })
  @ApiResponse({ status: 200, description: 'application/pdf' })
  @Get('versions/:version/pdf')
  async exportVersion(
    @Param('clientId') clientId: string,
    @Param('version', ParseIntPipe) version: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<StreamableFile> {
    const pdf = await this.service.exportMealPlanVersion({
      clientId,
      version,
      requesterId: req.user.id,
      asClient: false,
    });
    return toPdfResponse(pdf);
  }
}

@ApiTags('PDF export — Meal plan (client mirror)')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
@Controller('me/nutritionist/meal-plan')
export class MealPlanMirrorPdfController {
  constructor(private readonly service: PdfExportService) {}

  @ApiOperation({ summary: "Export my own nutritionist's published version" })
  @ApiResponse({ status: 200, description: 'application/pdf' })
  @Get('versions/:version/pdf')
  async exportVersion(
    @Param('version', ParseIntPipe) version: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<StreamableFile> {
    const pdf = await this.service.exportMealPlanVersion({
      version,
      requesterId: req.user.id,
      asClient: true,
    });
    return toPdfResponse(pdf);
  }
}

@ApiTags('PDF export — AI Workout')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
@Controller('workouts')
export class WorkoutPdfController {
  constructor(private readonly service: PdfExportService) {}

  @ApiOperation({ summary: 'Export my current AI-generated workout' })
  @ApiResponse({ status: 200, description: 'application/pdf' })
  @Get('current/pdf')
  async exportCurrent(
    @Request() req: AuthenticatedRequest,
  ): Promise<StreamableFile> {
    const pdf = await this.service.exportAiWorkout(req.user.id);
    return toPdfResponse(pdf);
  }
}

@ApiTags('PDF export — Educator workout (educador)')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, PhysicalEducatorGuard)
@Controller('educator/students/:studentId/workouts')
export class EducatorWorkoutPdfController {
  constructor(private readonly service: PdfExportService) {}

  @ApiOperation({ summary: "Export a client's EducatorWorkout" })
  @ApiResponse({ status: 200, description: 'application/pdf' })
  @Get(':workoutId/pdf')
  async exportWorkout(
    @Param('studentId') studentId: string,
    @Param('workoutId') workoutId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<StreamableFile> {
    const pdf = await this.service.exportEducatorWorkoutAsEducator(
      workoutId,
      studentId,
      req.user.id,
    );
    return toPdfResponse(pdf);
  }
}

@ApiTags('PDF export — Educator workout (client mirror)')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
@Controller('me/educator-workouts')
export class EducatorWorkoutMirrorPdfController {
  constructor(private readonly service: PdfExportService) {}

  @ApiOperation({ summary: 'Export my own active EducatorWorkout' })
  @ApiResponse({ status: 200, description: 'application/pdf' })
  @Get('pdf')
  async exportActive(
    @Request() req: AuthenticatedRequest,
  ): Promise<StreamableFile> {
    const pdf = await this.service.exportEducatorWorkoutAsClient(req.user.id);
    return toPdfResponse(pdf);
  }
}

@ApiTags('PDF export — Form record (professional)')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, ProfessionalGuard)
@Controller('professionals/clients/:clientId/form-records')
export class FormRecordProfessionalPdfController {
  constructor(private readonly service: PdfExportService) {}

  @ApiOperation({ summary: "Export a client's FormRecord" })
  @ApiResponse({ status: 200, description: 'application/pdf' })
  @Get(':id/pdf')
  async exportRecord(
    @Param('clientId') clientId: string,
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<StreamableFile> {
    const pdf = await this.service.exportFormRecord(id, clientId, {
      userId: req.user.id,
    });
    return toPdfResponse(pdf);
  }
}

@ApiTags('PDF export — Form record (academia)')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
@Controller('academia/clients/:clientId/form-records')
export class FormRecordAcademiaPdfController {
  constructor(private readonly service: PdfExportService) {}

  @ApiOperation({ summary: "Export a client's FormRecord (academia side)" })
  @ApiResponse({ status: 200, description: 'application/pdf' })
  @Get(':id/pdf')
  async exportRecord(
    @Param('clientId') clientId: string,
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest & { user: { academiaId?: string } },
  ): Promise<StreamableFile> {
    const pdf = await this.service.exportFormRecord(id, clientId, {
      userId: req.user.id,
      academiaId: req.user.academiaId,
    });
    return toPdfResponse(pdf);
  }
}
