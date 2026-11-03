import { PublicWebhook } from '@/common/decorators/publicWebhook.decorator';
import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SubscriptionWebhookService } from './subscriptionWebhook.service';

// Public and token-authenticated (ADR-010 decision 5) — no AuthGuard, and
// @PublicWebhook() opts this route out of the global ApiKeyGuard, since
// Asaas cannot send the application's shared secret. One single platform
// token, unlike the per-account pattern `billing/webhooks/asaas` uses.
@ApiTags('Subscription')
@Controller('users/subscription/webhook')
export class SubscriptionWebhookController {
  constructor(private readonly service: SubscriptionWebhookService) {}

  @ApiOperation({
    summary: "Asaas notices for Vita Flow's own platform subscriptions",
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 401, description: 'Missing or wrong webhook token.' })
  @PublicWebhook()
  @Post()
  @HttpCode(200)
  async handle(
    @Headers('asaas-access-token') token: unknown,
    @Body() body: unknown,
  ): Promise<void> {
    await this.service.handle(token, body);
  }
}
