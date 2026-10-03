import { AuthGuard } from '@/auth/auth.guard';
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
import { BookSlotDto } from './dto/bookSlot.Dto';
import { ListOpenSlotsDto } from './dto/listOpenSlots.Dto';
import { SetOnlineLinkDto } from './dto/setOnlineLink.Dto';
import { SchedulingService } from './scheduling.service';
import { SlotEntity, UpcomingSlotEntity } from './slot.entity';
import type { UpcomingFixedItem } from './fixed-times/fixedSessions.service';

@ApiTags('Scheduling')
@Controller('scheduling')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
export class BookingController {
  constructor(private readonly service: SchedulingService) {}

  @ApiOperation({ summary: "A professional's open slots in a date range" })
  @ApiResponse({ status: 200, type: [SlotEntity] })
  @Get('slots')
  async listOpenSlots(@Query() query: ListOpenSlotsDto): Promise<SlotEntity[]> {
    return await this.service.listOpenSlots(
      query.professionalId,
      new Date(query.from),
      new Date(query.to),
    );
  }

  @ApiOperation({
    summary: 'Book an open slot instantly — no approval step',
  })
  @ApiResponse({ status: 201, type: SlotEntity })
  @ApiResponse({
    status: 403,
    description: 'Sem vínculo ativo com o profissional.',
  })
  @ApiResponse({
    status: 409,
    description: 'Este horário acabou de ser reservado por outra pessoa.',
  })
  @Post('slots/:id/book')
  async bookSlot(
    @Param('id') id: string,
    @Body() dto: BookSlotDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<SlotEntity> {
    return await this.service.bookSlot(req.user.id, id, dto);
  }

  @ApiOperation({ summary: 'Cancel a booked session — either party' })
  @ApiResponse({ status: 204, description: 'Sem corpo de resposta.' })
  @HttpCode(204)
  @Post('slots/:id/cancel')
  async cancelSlot(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.cancelSlot(req.user.id, id);
  }

  @ApiOperation({
    summary: 'Set the online-session link — professional only, no validation',
  })
  @ApiResponse({ status: 200, type: SlotEntity })
  @Patch('slots/:id/link')
  async setOnlineLink(
    @Param('id') id: string,
    @Body() dto: SetOnlineLinkDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<SlotEntity> {
    return await this.service.setOnlineLink(req.user.id, id, dto);
  }

  @ApiOperation({
    summary: "The caller's upcoming sessions, as a user or a professional",
  })
  @ApiResponse({ status: 200, type: [UpcomingSlotEntity] })
  @Get('upcoming')
  async listUpcoming(
    @Request() req: AuthenticatedRequest,
  ): Promise<Array<UpcomingSlotEntity | UpcomingFixedItem>> {
    return await this.service.listUpcoming(req.user.id);
  }
}
