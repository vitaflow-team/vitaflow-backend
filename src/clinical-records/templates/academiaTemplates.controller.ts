import { AcademiaOwnerGuard } from '@/common/guards/academiaOwner.guard';
import { AuthGuard } from '@/auth/auth.guard';
import type { AcademiaOwnerRequest } from '@/common/types/academiaOwnerRequest';
import {
  Body,
  Controller,
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
import { TemplatePurpose } from '@prisma/client';
import { TemplatesService } from './templates.service';
import { CreateTemplateDTO } from './dto/createTemplate.Dto';
import { TemplateResponseDTO } from './dto/templateResponse.Dto';
import { UpdateTemplateDTO } from './dto/updateTemplate.Dto';

const TEMPLATE_NOT_FOUND = 'Modelo não encontrado.';

// Same owner-only-management shape as AcademiaAccessPlanController: the
// academia's shared catalog, every employed educator uses it read-only
// through the records endpoints, only the owner/manager manages it here.
@ApiTags('Clinical records — Templates (academia)')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, AcademiaOwnerGuard)
@Controller('academia/templates')
export class AcademiaTemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @ApiOperation({ summary: "This academia's shared template catalog" })
  @Get()
  async list(
    @Request() req: AcademiaOwnerRequest,
    @Query('purpose') purpose?: TemplatePurpose,
  ): Promise<TemplateResponseDTO[]> {
    return await this.templates.list(
      { academiaId: req.user.academiaId },
      purpose,
    );
  }

  @ApiOperation({ summary: 'Create a catalog entry' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400, description: 'Invalid fields.' })
  @Post()
  async create(
    @Body() dto: CreateTemplateDTO,
    @Request() req: AcademiaOwnerRequest,
  ): Promise<TemplateResponseDTO> {
    return await this.templates.create(
      { academiaId: req.user.academiaId },
      dto,
    );
  }

  @ApiOperation({
    summary: 'Edit a template (fields never retroactively change past records)',
  })
  @ApiResponse({ status: 404, description: TEMPLATE_NOT_FOUND })
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDTO,
    @Request() req: AcademiaOwnerRequest,
  ): Promise<TemplateResponseDTO> {
    return await this.templates.update(
      { academiaId: req.user.academiaId },
      id,
      dto,
    );
  }

  @ApiOperation({
    summary: 'Soft-remove from future selection, keep past records',
  })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: TEMPLATE_NOT_FOUND })
  @HttpCode(204)
  @Post(':id/discontinue')
  async discontinue(
    @Param('id') id: string,
    @Request() req: AcademiaOwnerRequest,
  ): Promise<void> {
    await this.templates.discontinue({ academiaId: req.user.academiaId }, id);
  }
}
