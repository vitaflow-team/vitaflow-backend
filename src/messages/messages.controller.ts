import { AuthGuard } from '@/auth/auth.guard';
import { DualBucketThrottlerGuard } from '@/auth/dualBucketThrottler.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
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
import { Throttle } from '@nestjs/throttler';
import { PollMessagesDto } from './dto/pollMessages.Dto';
import { SendMessageDto } from './dto/sendMessage.Dto';
import { ConversationSummaryEntity, MessageEntity } from './message.entity';
import {
  SEND_THROTTLE_LIMIT,
  SEND_THROTTLE_TTL_MS,
} from './messages.constants';
import { MessagesService } from './messages.service';

@ApiTags('Messages')
@Controller('conversations')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
export class MessagesController {
  constructor(private readonly service: MessagesService) {}

  @ApiOperation({
    summary: "List the caller's conversations, newest activity first",
  })
  @ApiResponse({ status: 200, type: [ConversationSummaryEntity] })
  @Get()
  async listConversations(
    @Request() req: AuthenticatedRequest,
  ): Promise<ConversationSummaryEntity[]> {
    return await this.service.listConversations(req.user.id);
  }

  @ApiOperation({
    summary:
      'Poll for messages in a conversation, optionally only those after a given message id',
  })
  @ApiResponse({ status: 200, type: [MessageEntity] })
  @ApiResponse({ status: 404, description: 'Conversa não encontrada.' })
  @Get(':id/messages')
  async getMessages(
    @Param('id') id: string,
    @Query() query: PollMessagesDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<MessageEntity[]> {
    return await this.service.getMessages(req.user.id, id, query.after);
  }

  @ApiOperation({
    summary:
      'Send a message; creates the conversation on first send if eligible',
  })
  @ApiResponse({ status: 201, type: MessageEntity })
  @ApiResponse({
    status: 403,
    description: 'Sem vínculo ativo com o destinatário.',
  })
  @ApiResponse({ status: 429, description: 'Limite de envio excedido.' })
  @UseGuards(DualBucketThrottlerGuard)
  @Throttle({
    default: { limit: SEND_THROTTLE_LIMIT, ttl: SEND_THROTTLE_TTL_MS },
  })
  @Post(':counterpartId/messages')
  async sendMessage(
    @Param('counterpartId') counterpartId: string,
    @Body() dto: SendMessageDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<MessageEntity> {
    return await this.service.sendMessage(
      req.user.id,
      counterpartId,
      dto.content,
    );
  }

  @ApiOperation({
    summary: 'Report a conversation for Vita Flow backoffice review',
  })
  @ApiResponse({ status: 204, description: 'Sem corpo de resposta.' })
  @ApiResponse({ status: 404, description: 'Conversa não encontrada.' })
  @HttpCode(204)
  @Post(':id/report')
  async reportConversation(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.reportConversation(req.user.id, id);
  }
}
