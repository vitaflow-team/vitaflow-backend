import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import {
  Body,
  Controller,
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
import { FixedSessionsService } from './fixedSessions.service';
import { SetFixedSessionLinkDTO } from './dto/setFixedSessionLink.Dto';

@ApiTags('Scheduling')
@Controller('scheduling/fixed-sessions')
@ApiBearerAuth('jwt')
export class FixedSessionsController {
  constructor(private readonly service: FixedSessionsService) {}

  @ApiOperation({
    summary:
      'Cancel one date of a fixed time (the educator or the linked student)',
  })
  @ApiResponse({ status: 204, description: 'Session canceled.' })
  @ApiResponse({ status: 400, description: 'Already started or ended.' })
  @ApiResponse({
    status: 404,
    description: 'Session not found for this caller.',
  })
  @ApiResponse({ status: 409, description: 'Already canceled.' })
  @Post(':id/cancel')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async cancel(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.cancel(req.user.id, id);
  }

  @ApiOperation({
    summary: 'Set the link of one fixed session (educator only)',
  })
  @ApiResponse({ status: 200, description: 'Link set.' })
  @ApiResponse({
    status: 400,
    description: 'Invalid link or presencial session.',
  })
  @ApiResponse({ status: 404, description: 'Session not found.' })
  @Patch(':id/link')
  @UseGuards(AuthGuard, PhysicalEducatorGuard)
  async setLink(
    @Param('id') id: string,
    @Body() dto: SetFixedSessionLinkDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.setLink(req.user.id, id, dto.link);
  }
}
