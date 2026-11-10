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
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ServicePackageService } from './servicePackage.service';
import { CreateServicePackageDTO } from './dto/createServicePackage.Dto';
import { UpdateServicePackageDTO } from './dto/updateServicePackage.Dto';

const PACKAGE_NOT_FOUND = 'Pacote de sessões não encontrado.';

@ApiTags('Service Packages')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, ProfessionalGuard)
@Controller('service-packages')
export class ServicePackageController {
  constructor(private readonly packages: ServicePackageService) {}

  @ApiOperation({
    summary: "The calling professional's own package catalog",
  })
  @Get()
  async list(@Request() req: AuthenticatedRequest) {
    return await this.packages.list(req.user.id);
  }

  @ApiOperation({ summary: 'Create a session/consultation package' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400, description: 'Campo inválido.' })
  @Post()
  async create(
    @Body() dto: CreateServicePackageDTO,
    @Request() req: AuthenticatedRequest,
  ) {
    return await this.packages.create(req.user.id, dto);
  }

  @ApiOperation({
    summary: 'Edit a package in place — no versioning',
  })
  @ApiResponse({ status: 404, description: PACKAGE_NOT_FOUND })
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateServicePackageDTO,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.packages.update(req.user.id, id, dto);
  }

  @ApiOperation({
    summary: 'Deactivate a package — soft, the row is never deleted',
  })
  @ApiResponse({ status: 204, description: 'Sem corpo de resposta.' })
  @ApiResponse({ status: 404, description: PACKAGE_NOT_FOUND })
  @HttpCode(204)
  @Post(':id/deactivate')
  async deactivate(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.packages.deactivate(req.user.id, id);
  }
}
