import { AcademiaOwnerGuard } from '@/common/guards/academiaOwner.guard';
import { AuthGuard } from '@/auth/auth.guard';
import type { AcademiaOwnerRequest } from '@/common/types/academiaOwnerRequest';
import { AcademiaStaffMemberRepository } from '@/repositories/academia/academiaStaffMember.repository';
import { AppError } from '@/utils/app.erro';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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
import { AcademiaStaffAuthService } from './academiaStaffAuth.service';
import { ActivateAcademiaStaffDTO } from './dto/activateAcademiaStaff.Dto';

const STAFF_NOT_FOUND = 'Recepcionista não encontrada.';

@ApiTags('Academia — Staff')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, AcademiaOwnerGuard)
@Controller('academia/staff')
export class AcademiaStaffController {
  constructor(private readonly staff: AcademiaStaffMemberRepository) {}

  @ApiOperation({ summary: "List this academia's receptionists" })
  @Get()
  async list(@Request() req: AcademiaOwnerRequest) {
    return await this.staff.listByAcademia(req.user.academiaId);
  }

  @ApiOperation({ summary: "Remove a receptionist's access" })
  @ApiResponse({ status: 204, description: 'Sem corpo de resposta.' })
  @ApiResponse({ status: 404, description: STAFF_NOT_FOUND })
  @HttpCode(204)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Request() req: AcademiaOwnerRequest,
  ): Promise<void> {
    const removed = await this.staff.setActive(id, req.user.academiaId, false);
    if (!removed) {
      throw new AppError(STAFF_NOT_FOUND, 404, 'staff_not_found');
    }
  }
}

@ApiTags('Academia — Staff Activation')
@Controller('academia/staff')
export class AcademiaStaffActivationController {
  constructor(private readonly staffAuth: AcademiaStaffAuthService) {}

  @ApiOperation({
    summary: 'Activate a receptionist account, setting its password',
  })
  @ApiResponse({ status: 204, description: 'Sem corpo de resposta.' })
  @ApiResponse({ status: 400, description: 'Token inválido ou expirado.' })
  @HttpCode(204)
  @Post('activate')
  async activate(@Body() dto: ActivateAcademiaStaffDTO): Promise<void> {
    await this.staffAuth.activate(dto.token, dto.password);
  }
}
