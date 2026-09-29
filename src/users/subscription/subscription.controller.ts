import { AuthGuard } from '@/auth/auth.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
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
import { SubscriptionResponseDTO } from './dto/subscriptionResponse.Dto';
import { SubscriptionStateResponseDTO } from './dto/subscriptionStateResponse.Dto';
import { UpdateSubscriptionDTO } from './dto/updateSubscription.Dto';
import { SubscriptionService } from './subscription.service';

// Authenticated end-user routes only. The Stripe webhook sync lives in
// SubscriptionSyncController, so this class can be guarded as a whole.
@ApiTags('Subscription')
@ApiBearerAuth('jwt')
@Controller('users/subscription')
@UseGuards(AuthGuard)
export class SubscriptionController {
  constructor(private readonly service: SubscriptionService) {}

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
  @ApiResponse({
    status: 200,
    description: 'Subscription state.',
    type: SubscriptionStateResponseDTO,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  @Get()
  async getSubscription(
    @Request() req: AuthenticatedRequest,
  ): Promise<SubscriptionStateResponseDTO> {
    return await this.service.getForUser(req.user.id);
  }

  @ApiOperation({
    summary: "Update the authenticated user's subscription",
    description:
      'Self-service sync, called by the frontend right after a Stripe ' +
      'checkout redirect returns, so the UI reflects the change without ' +
      "waiting for the webhook. Only ever touches the caller's own record.",
  })
  @ApiResponse({
    status: 200,
    description: 'Subscription updated.',
    type: SubscriptionResponseDTO,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid body, or a subscription Stripe does not confirm.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Product not found.' })
  @Patch()
  async patchSubscription(
    @Body() body: UpdateSubscriptionDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<SubscriptionResponseDTO> {
    return await this.service.updateForUser(req.user.id, body);
  }
}
