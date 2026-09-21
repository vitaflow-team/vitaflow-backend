import { AuthGuard } from '@/auth/auth.guard';
import {
  Body,
  Controller,
  Get,
  Patch,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SyncSubscriptionDTO, UpdateSubscriptionDTO } from './subscription.Dto';
import { SubscriptionService } from './subscription.service';

@ApiTags('Subscription')
@Controller('users/subscription')
export class SubscriptionController {
  constructor(private service: SubscriptionService) {}

  @ApiOperation({
    summary: "Get the authenticated user's raw subscription state",
    description:
      'Includes the Stripe subscription id — server-to-server use only ' +
      '(cancel/reactivate/change-plan actions). Never render this ' +
      'response into a Client Component prop; use GET /profile for ' +
      'anything client-rendered. `expiresAt` and `autoRenew` are derived ' +
      'from the subscription status alone here (no product is loaded), ' +
      'unlike GET /profile, which also checks the plan price.',
  })
  @ApiResponse({ status: 200, description: 'Subscription state.' })
  @ApiBearerAuth('jwt')
  @UseGuards(AuthGuard)
  @Get()
  async getSubscription(@Request() req: { user: { id: string } }) {
    return await this.service.getForUser(req.user.id);
  }

  @ApiOperation({
    summary: "Update the authenticated user's subscription",
    description:
      'Self-service sync, called by the frontend right after a Stripe ' +
      'checkout redirect returns, so the UI reflects the change without ' +
      "waiting for the webhook. Only ever touches the caller's own record.",
  })
  @ApiResponse({ status: 200, description: 'Subscription updated.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Product not found.' })
  @ApiBearerAuth('jwt')
  @UseGuards(AuthGuard)
  @Patch()
  async patchSubscription(
    @Body() body: UpdateSubscriptionDTO,
    @Request() req: { user: { id: string } },
  ) {
    return await this.service.updateForUser(req.user.id, body);
  }

  @ApiOperation({
    summary: 'Sync subscription state from a Stripe webhook event',
    description:
      "Server-to-server only — identifies the user by Stripe's customer " +
      'id (or a userId hint on first link), not by session. Gated by the ' +
      'shared application secret (ApiKeyGuard), not a user JWT.',
  })
  @ApiResponse({ status: 200, description: 'Subscription synced.' })
  @Patch('sync')
  async syncSubscription(@Body() body: SyncSubscriptionDTO) {
    return await this.service.syncFromWebhook(body);
  }
}
