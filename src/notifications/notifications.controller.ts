import { AuthGuard } from '@/auth/auth.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
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
import { NotificationCategory } from '@prisma/client';
import { PaginationQueryDto } from './dto/paginationQuery.Dto';
import { SetPreferenceDto } from './dto/setPreference.Dto';
import {
  NotificationEntity,
  NotificationPreferencesEntity,
  UnreadCountEntity,
} from './notification.entity';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@Controller('notifications')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @ApiOperation({
    summary: "Paginated list of the user's notifications, newest first",
  })
  @ApiResponse({ status: 200, type: [NotificationEntity] })
  @Get()
  async list(
    @Query() query: PaginationQueryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<NotificationEntity[]> {
    return await this.service.listForUser(req.user.id, query.page);
  }

  @ApiOperation({ summary: 'Unread count, for the bell badge' })
  @ApiResponse({ status: 200, type: UnreadCountEntity })
  @Get('unread-count')
  async unreadCount(
    @Request() req: AuthenticatedRequest,
  ): Promise<UnreadCountEntity> {
    const count = await this.service.getUnreadCount(req.user.id);
    return { count };
  }

  @ApiOperation({
    summary: 'Current preferences, with documented defaults filled in',
  })
  @ApiResponse({ status: 200, type: NotificationPreferencesEntity })
  @Get('preferences')
  async getPreferences(
    @Request() req: AuthenticatedRequest,
  ): Promise<Record<NotificationCategory, boolean>> {
    return await this.service.getPreferences(req.user.id);
  }

  @ApiOperation({ summary: "Set one category's enabled state" })
  @ApiResponse({ status: 204, description: 'Sem corpo de resposta.' })
  @HttpCode(204)
  @Patch('preferences/:category')
  async setPreference(
    @Param('category', new ParseEnumPipe(NotificationCategory))
    category: NotificationCategory,
    @Body() dto: SetPreferenceDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.setPreference(req.user.id, category, dto.enabled);
  }

  @ApiOperation({ summary: 'Mark one notification read' })
  @ApiResponse({ status: 204, description: 'Sem corpo de resposta.' })
  @ApiResponse({ status: 404, description: 'Notificação não encontrada.' })
  @HttpCode(204)
  @Post(':id/read')
  async markRead(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.markRead(req.user.id, id);
  }
}
