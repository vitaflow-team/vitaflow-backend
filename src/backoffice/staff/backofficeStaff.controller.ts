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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { BackofficeStaffService } from './backofficeStaff.service';
import { AcceptStaffInvitationDTO } from './dto/acceptStaffInvitation.Dto';
import { ActivateStaffDTO } from './dto/activateStaff.Dto';
import { ChangeStaffTierDTO } from './dto/changeStaffTier.Dto';
import { InviteStaffDTO } from './dto/inviteStaff.Dto';
import { PreviewStaffInvitationDTO } from './dto/previewStaffInvitation.Dto';
import { StaffActionResponseDTO } from './dto/staffActionResponse.Dto';
import { StaffInvitationPreviewResponseDTO } from './dto/staffInvitationPreviewResponse.Dto';
import { StaffListItemResponseDTO } from './dto/staffListItemResponse.Dto';

// code-standards: class-level AuthGuard — the public token routes (activate,
// preview, accept) and the admin routes have shared this controller since
// platform-admin-access; guards stay per method rather than splitting it.
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

  @ApiOperation({
    summary: 'Preview a staff invitation sent to an existing account',
    description:
      'Returns the tier being offered and whether the invited account ' +
      'already signs in with Google. Never identifies the account.',
  })
  @ApiResponse({ status: 201, type: StaffInvitationPreviewResponseDTO })
  @ApiResponse({ status: 400, description: 'invalid_token' })
  @ApiResponse({ status: 429, description: 'Too many attempts.' })
  @Post('invitation/preview')
  @UseGuards(DualBucketThrottlerGuard)
  async previewInvitation(
    @Body() body: PreviewStaffInvitationDTO,
  ): Promise<StaffInvitationPreviewResponseDTO> {
    return await this.service.previewInvitation(body.token);
  }

  @ApiOperation({
    summary: 'Accept a staff invitation with the account password',
    description:
      'Grants the offered tier to the existing account only when its ' +
      'current password is supplied. A wrong password keeps the link valid.',
  })
  @ApiResponse({ status: 201, type: StaffActionResponseDTO })
  @ApiResponse({ status: 400, description: 'invalid_token' })
  @ApiResponse({ status: 401, description: 'invalid_password' })
  @ApiResponse({ status: 409, description: 'account_inactive' })
  @ApiResponse({ status: 429, description: 'Too many attempts.' })
  @Post('accept')
  @UseGuards(DualBucketThrottlerGuard)
  async accept(
    @Body() body: AcceptStaffInvitationDTO,
  ): Promise<StaffActionResponseDTO> {
    await this.service.accept(body.token, body.password);
    return { ok: true };
  }

  @ApiOperation({
    summary: 'List internal staff and pending invitations, both tiers',
  })
  @ApiResponse({ status: 200, type: [StaffListItemResponseDTO] })
  @ApiBearerAuth('jwt')
  @UseGuards(AuthGuard, BackofficeGuard, AdminTierGuard)
  @Get()
  async list(): Promise<StaffListItemResponseDTO[]> {
    return await this.service.list();
  }

  @ApiOperation({
    summary: 'Invite a colleague to internal access',
    description:
      'An email without an account receives a new inactive staff account. ' +
      'An email that already has an account receives a pending invitation ' +
      'on that account; nothing changes until its owner accepts.',
  })
  @ApiResponse({ status: 201, type: StaffActionResponseDTO })
  @ApiResponse({
    status: 409,
    description: 'already_staff or invitation_pending',
  })
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

  @ApiOperation({
    summary: 'Send a pending staff invitation again',
    description: 'Replaces the previous link, which stops working.',
  })
  @ApiResponse({ status: 201, type: StaffActionResponseDTO })
  @ApiResponse({ status: 404, description: 'staff_not_found' })
  @ApiResponse({ status: 409, description: 'not_pending' })
  @ApiBearerAuth('jwt')
  @UseGuards(AuthGuard, BackofficeGuard, AdminTierGuard)
  @Post(':id/resend')
  async resend(@Param('id') id: string): Promise<StaffActionResponseDTO> {
    await this.service.resend(id);
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

  @ApiOperation({
    summary: "Remove a staff member's internal access",
    description:
      'Withdraws access only; the account, its plan and its data remain. ' +
      'For an invitation not yet accepted, cancels the invitation.',
  })
  @ApiResponse({ status: 200, type: StaffActionResponseDTO })
  @ApiResponse({ status: 404, description: 'staff_not_found' })
  @ApiResponse({ status: 409, description: 'last_admin_required' })
  @ApiBearerAuth('jwt')
  @UseGuards(AuthGuard, BackofficeGuard, AdminTierGuard)
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ ok: true }> {
    await this.service.remove(id);
    return { ok: true };
  }
}
