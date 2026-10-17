import { AuthGuard } from '@/auth/auth.guard';
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
import { TemplatePurpose } from '@prisma/client';
import { FormRecordsService } from './formRecords.service';
import { CreateFormRecordDTO } from './dto/createFormRecord.Dto';
import { FormRecordResponseDTO } from './dto/formRecordResponse.Dto';
import { TemplateResponseDTO } from '../templates/dto/templateResponse.Dto';

// Not AcademiaOwnerGuard-only: both the academia's owner/manager AND an
// employed, currently-assigned physical educator may read/write here
// (ADR-012) — the real decision is made inside assertCanRecordFormAgainstClient
// against the loaded Client, same as the professional path but with an
// academiaId carried from the caller's own account when they are an owner.
@ApiTags('Clinical records — Form records (academia)')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
@Controller('academia/clients/:clientId/form-records')
export class AcademiaFormRecordsController {
  constructor(private readonly records: FormRecordsService) {}

  @ApiOperation({
    summary:
      "The academia's templates available for this client — the owner/manager or the assigned employed educator",
  })
  @Get('templates')
  async templates(
    @Param('clientId') clientId: string,
    @Query('purpose') purpose: TemplatePurpose | undefined,
    @Request() req: AuthenticatedRequest & { user: { academiaId?: string } },
  ): Promise<TemplateResponseDTO[]> {
    return await this.records.listTemplatesForClient(
      req.user.id,
      req.user.academiaId ?? undefined,
      clientId,
      purpose,
    );
  }

  @ApiOperation({ summary: 'History for a purpose' })
  @Get()
  async history(
    @Param('clientId') clientId: string,
    @Query('purpose') purpose: TemplatePurpose,
    @Request() req: AuthenticatedRequest & { user: { academiaId?: string } },
  ): Promise<FormRecordResponseDTO[]> {
    return await this.records.findHistory(
      req.user.id,
      req.user.academiaId ?? undefined,
      clientId,
      purpose,
    );
  }

  @ApiOperation({
    summary:
      'Record directly — the owner/manager, or the assigned employed educator',
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 403, description: 'Not owner, nor assigned here.' })
  @Post()
  async create(
    @Param('clientId') clientId: string,
    @Body() dto: CreateFormRecordDTO,
    @Request() req: AuthenticatedRequest & { user: { academiaId?: string } },
  ): Promise<FormRecordResponseDTO> {
    return await this.records.create(
      req.user.id,
      req.user.academiaId ?? undefined,
      clientId,
      dto,
    );
  }
}
