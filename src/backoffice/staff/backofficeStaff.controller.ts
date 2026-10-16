import { AuthGuard } from '@/auth/auth.guard';
import { DualBucketThrottlerGuard } from '@/auth/dualBucketThrottler.guard';
import { AdminTierGuard } from '@/common/guards/adminTier.guard';
import { BackofficeGuard } from '@/common/guards/backoffice.guard';
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
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  BackofficeStaffService,
  StaffListItem,
} from './backofficeStaff.service';
import { ActivateStaffDTO } from './dto/activateStaff.Dto';
import { ChangeStaffTierDTO } from './dto/changeStaffTier.Dto';
import { InviteStaffDTO } from './dto/inviteStaff.Dto';

@ApiTags('Backoffice staff')
@Controller('backoffice/staff')
export class BackofficeStaffController {
  constructor(private readonly service: BackofficeStaffService) {}

  @ApiOperation({ summary: 'Activate an invited staff account' })
  @Post('activate')
  @UseGuards(DualBucketThrottlerGuard)
  async activate(@Body() body: ActivateStaffDTO): Promise<{ ok: true }> {
    await this.service.activate(body.token, body.password);
    return { ok: true };
  }

  @ApiOperation({ summary: 'List internal staff, both tiers' })
  @ApiBearerAuth('jwt')
  @UseGuards(AuthGuard, BackofficeGuard, AdminTierGuard)
  @Get()
  async list(): Promise<StaffListItem[]> {
    return await this.service.list();
  }

  @ApiOperation({ summary: 'Invite a new internal staff member' })
  @ApiBearerAuth('jwt')
  @UseGuards(AuthGuard, BackofficeGuard, AdminTierGuard)
  @HttpCode(201)
  @Post()
  async invite(
    @Body() body: InviteStaffDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<{ ok: true }> {
    await this.service.invite(body.email, body.tier, req.user.id);
    return { ok: true };
  }

  @ApiOperation({ summary: "Change a staff member's tier" })
  @ApiBearerAuth('jwt')
  @UseGuards(AuthGuard, BackofficeGuard, AdminTierGuard)
  @Patch(':id')
  async changeTier(
    @Param('id') id: string,
    @Body() body: ChangeStaffTierDTO,
  ): Promise<{ ok: true }> {
    await this.service.changeTier(id, body.tier);
    return { ok: true };
  }

  @ApiOperation({ summary: "Remove a staff member's internal access" })
  @ApiBearerAuth('jwt')
  @UseGuards(AuthGuard, BackofficeGuard, AdminTierGuard)
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ ok: true }> {
    await this.service.remove(id);
    return { ok: true };
  }
}
