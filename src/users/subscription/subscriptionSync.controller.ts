import { Body, Controller, Patch } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SubscriptionResponseDTO } from './dto/subscriptionResponse.Dto';
import { SyncSubscriptionDTO } from './dto/syncSubscription.Dto';
import { SubscriptionService } from './subscription.service';

// Server-to-server Stripe webhook sync (ADR-001). Deliberately carries no
// AuthGuard: it is gated only by the global ApiKeyGuard's shared secret,
// because the caller is the frontend's webhook handler, not a user session.
@ApiTags('Subscription sync')
@Controller('users/subscription')
export class SubscriptionSyncController {
  constructor(private readonly service: SubscriptionService) {}

  @ApiOperation({
    summary: 'Sync subscription state from a Stripe webhook event',
    description:
      "Server-to-server only — identifies the user by Stripe's customer " +
      'id (or a userId hint on first link), not by session. Gated by the ' +
      'shared application secret (ApiKeyGuard), not a user JWT. The body ' +
      'is empty when no user matches, so Stripe does not retry.',
  })
  @ApiResponse({
    status: 200,
    description: 'Subscription synced.',
    type: SubscriptionResponseDTO,
  })
  @ApiResponse({ status: 400, description: 'Invalid body.' })
  @ApiResponse({ status: 403, description: 'Missing or wrong secret.' })
  @Patch('sync')
  async syncSubscription(
    @Body() body: SyncSubscriptionDTO,
  ): Promise<SubscriptionResponseDTO | null> {
    return await this.service.syncFromWebhook(body);
  }
}
