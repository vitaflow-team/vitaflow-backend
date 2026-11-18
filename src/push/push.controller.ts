import { AuthGuard } from '@/auth/auth.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { NotificationCategory } from '@prisma/client';
import { DeviceEndpointDto } from './dto/deviceEndpoint.Dto';
import { DeviceSyncResponse } from './dto/deviceSyncResponse.Dto';
import { InvitationClaimResponse } from './dto/invitationClaimResponse.Dto';
import { PushSettingsResponse } from './dto/pushSettingsResponse.Dto';
import { RegisterDeviceDto } from './dto/registerDevice.Dto';
import { SetDiaryReminderDto } from './dto/setDiaryReminder.Dto';
import { SetPushCategoryDto } from './dto/setPushCategory.Dto';
import { SetQuietHoursDto } from './dto/setQuietHours.Dto';
import { PushDevicesService } from './pushDevices.service';
import { PushSettingsService } from './pushSettings.service';

const NO_BODY = 'Sem corpo de resposta.';

@ApiTags('Push')
@Controller('push')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
export class PushController {
  constructor(
    private readonly devices: PushDevicesService,
    private readonly settings: PushSettingsService,
  ) {}

  @ApiOperation({
    summary:
      'Push settings, effective category states, and the VAPID public key',
  })
  @ApiResponse({ status: 200, description: 'Push settings of the caller.' })
  @Get('settings')
  async getSettings(
    @Request() req: AuthenticatedRequest,
  ): Promise<PushSettingsResponse> {
    return await this.settings.getSettings(req.user.id);
  }

  @ApiOperation({ summary: 'Register (or take over) this browser as a device' })
  @ApiResponse({ status: 204, description: NO_BODY })
  @ApiResponse({ status: 400, description: 'Invalid subscription.' })
  @ApiResponse({ status: 503, description: 'Push is not configured.' })
  @HttpCode(204)
  @Post('devices')
  async register(
    @Body() dto: RegisterDeviceDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.devices.register(req.user.id, dto);
  }

  @ApiOperation({ summary: 'Turn push off for this browser' })
  @ApiResponse({ status: 204, description: NO_BODY })
  @HttpCode(204)
  @Delete('devices')
  async turnOff(
    @Body() dto: DeviceEndpointDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.devices.turnOff(req.user.id, dto.endpoint);
  }

  @ApiOperation({ summary: 'Stop push for this browser at logout' })
  @ApiResponse({ status: 204, description: NO_BODY })
  @HttpCode(204)
  @Post('devices/logout')
  async logout(
    @Body() dto: DeviceEndpointDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.devices.logout(req.user.id, dto.endpoint);
  }

  @ApiOperation({ summary: 'Reactivate this browser after signing in again' })
  @ApiResponse({ status: 200, description: 'Whether the device is active.' })
  @HttpCode(200)
  @Post('devices/sync')
  async sync(
    @Body() dto: RegisterDeviceDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<DeviceSyncResponse> {
    return await this.devices.sync(req.user.id, {
      endpoint: dto.endpoint,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
    });
  }

  @ApiOperation({ summary: "Set one category's push state" })
  @ApiResponse({ status: 204, description: NO_BODY })
  @ApiResponse({ status: 400, description: 'Category not available.' })
  @HttpCode(204)
  @Put('categories/:category')
  async setCategory(
    @Param('category', new ParseEnumPipe(NotificationCategory))
    category: NotificationCategory,
    @Body() dto: SetPushCategoryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.settings.setCategory(req.user.id, category, dto.enabled);
  }

  @ApiOperation({ summary: 'Set quiet hours (Brasília time)' })
  @ApiResponse({ status: 204, description: NO_BODY })
  @ApiResponse({ status: 400, description: 'Invalid time.' })
  @HttpCode(204)
  @Put('quiet-hours')
  async setQuietHours(
    @Body() dto: SetQuietHoursDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.settings.setQuietHours(req.user.id, dto);
  }

  @ApiOperation({ summary: 'Set the daily food-diary reminder time' })
  @ApiResponse({ status: 204, description: NO_BODY })
  @ApiResponse({ status: 400, description: 'Invalid time.' })
  @HttpCode(204)
  @Put('diary-reminder')
  async setDiaryReminder(
    @Body() dto: SetDiaryReminderDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.settings.setDiaryReminder(req.user.id, dto.time);
  }

  @ApiOperation({ summary: 'Claim the one-time push invitation' })
  @ApiResponse({ status: 200, description: 'Whether to show the invitation.' })
  @HttpCode(200)
  @Post('invitation/claim')
  async claimInvitation(
    @Request() req: AuthenticatedRequest,
  ): Promise<InvitationClaimResponse> {
    return await this.settings.claimInvitation(req.user.id);
  }
}
