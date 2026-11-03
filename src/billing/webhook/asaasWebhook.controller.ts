import { PublicWebhook } from '@/common/decorators/publicWebhook.decorator';
import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AsaasWebhookService } from './asaasWebhook.service';

// Public and token-authenticated (ADR-007) — no AuthGuard, no
// ProfessionalGuard, and @PublicWebhook() opts this route out of the
// global ApiKeyGuard, since Asaas cannot send the application's shared
// secret. UT-027 asserts the marker is present here (the platform
// subscription webhook, ADR-010, carries the same marker for the same
// reason, authenticated by its own single platform token instead).
@ApiTags('Billing')
@Controller('billing/webhooks/asaas')
export class AsaasWebhookController {
  constructor(private readonly service: AsaasWebhookService) {}

  @ApiOperation({ summary: 'Asaas payment notices' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 401, description: 'Generic — no account, bad token.' })
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
