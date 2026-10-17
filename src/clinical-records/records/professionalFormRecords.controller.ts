import { AuthGuard } from '@/auth/auth.guard';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import {
  Body,
  Controller,
  Get,
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
import { TemplatePurpose } from '@prisma/client';
import { FormRecordsService } from './formRecords.service';
import { CreateFormRecordDTO } from './dto/createFormRecord.Dto';
import { FormRecordResponseDTO } from './dto/formRecordResponse.Dto';
import { UpdateFormRecordDTO } from './dto/updateFormRecord.Dto';

@ApiTags('Clinical records — Form records (professional)')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, ProfessionalGuard)
@Controller('professionals/clients/:clientId/form-records')
export class ProfessionalFormRecordsController {
  constructor(private readonly records: FormRecordsService) {}

  @ApiOperation({ summary: 'History for a purpose' })
  @Get()
  async history(
    @Param('clientId') clientId: string,
    @Query('purpose') purpose: TemplatePurpose,
    @Request() req: AuthenticatedRequest,
  ): Promise<FormRecordResponseDTO[]> {
    return await this.records.findHistory(
      req.user.id,
      undefined,
      clientId,
      purpose,
    );
  }

  @ApiOperation({ summary: 'Fill a new record' })
  @ApiResponse({ status: 201 })
  @ApiResponse({
    status: 403,
    description: 'Not owned, or the declaration was not accepted.',
  })
  @Post()
  async create(
    @Param('clientId') clientId: string,
    @Body() dto: CreateFormRecordDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<FormRecordResponseDTO> {
    return await this.records.create(req.user.id, undefined, clientId, dto);
  }

  @ApiOperation({ summary: 'Revise an existing record in place' })
  @Patch(':id')
  async update(
    @Param('clientId') clientId: string,
    @Param('id') id: string,
    @Body() dto: UpdateFormRecordDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<FormRecordResponseDTO> {
    return await this.records.update(req.user.id, undefined, clientId, id, dto);
  }
}
