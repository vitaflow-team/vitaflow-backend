import { AuthGuard } from '@/auth/auth.guard';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
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

@ApiTags('Clinical records — Templates (professional)')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, ProfessionalGuard)
@Controller('professionals/templates')
export class ProfessionalTemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @ApiOperation({ summary: "The caller's own templates" })
  @Get()
  async list(
    @Request() req: AuthenticatedRequest,
    @Query('purpose') purpose?: TemplatePurpose,
  ): Promise<TemplateResponseDTO[]> {
    return await this.templates.list({ professionalId: req.user.id }, purpose);
  }

  @ApiOperation({ summary: 'Create a template' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400, description: 'Invalid fields.' })
  @Post()
  async create(
    @Body() dto: CreateTemplateDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<TemplateResponseDTO> {
    return await this.templates.create({ professionalId: req.user.id }, dto);
  }

  @ApiOperation({
    summary: 'Edit a template (fields never retroactively change past records)',
  })
  @ApiResponse({ status: 404, description: TEMPLATE_NOT_FOUND })
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<TemplateResponseDTO> {
    return await this.templates.update(
      { professionalId: req.user.id },
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
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.templates.discontinue({ professionalId: req.user.id }, id);
  }
}
