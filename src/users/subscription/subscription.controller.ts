import { AuthGuard } from '@/auth/auth.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import {
  Body,
  Controller,
  Get,
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
import { ChangePlanDTO } from './dto/changePlan.Dto';
import { CheckoutResponseDTO } from './dto/checkoutResponse.Dto';
import { CreateCheckoutDTO } from './dto/createCheckout.Dto';
import { SubscriptionResponseDTO } from './dto/subscriptionResponse.Dto';
import { SubscriptionStateResponseDTO } from './dto/subscriptionStateResponse.Dto';
import { SubscriptionService } from './subscription.service';

// Authenticated end-user routes only. The Asaas webhook lives in
// SubscriptionWebhookController, so this class can be guarded as a whole.
@ApiTags('Subscription')
@ApiBearerAuth('jwt')
@Controller('users/subscription')
@UseGuards(AuthGuard)
export class SubscriptionController {
  constructor(private readonly service: SubscriptionService) {}

  @ApiOperation({
    summary: "Get the authenticated user's raw subscription state",
    description:
      'Includes the Asaas subscription id — server-to-server use only ' +
      '(cancel/reactivate/change-plan actions). Never render this ' +
      'response into a Client Component prop; use GET /profile for ' +
      'anything client-rendered.',
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
    summary: 'Start an Asaas Checkout for a new subscription',
    description:
      'Returns the hosted checkout link to redirect the user to. The ' +
      'subscription itself is only recorded once the webhook confirms it.',
  })
  @ApiResponse({
    status: 200,
    description: 'Checkout created.',
    type: CheckoutResponseDTO,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Product not found.' })
  @Post('checkout')
  async createCheckout(
    @Body() body: CreateCheckoutDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<CheckoutResponseDTO> {
    return await this.service.createCheckout(req.user.id, body.productId);
  }

  @ApiOperation({ summary: "Change the authenticated user's plan" })
  @ApiResponse({
    status: 200,
    description: 'Plan changed.',
    type: SubscriptionResponseDTO,
  })
  @ApiResponse({ status: 400, description: 'No active subscription.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Product not found.' })
  @Patch('plan')
  async changePlan(
    @Body() body: ChangePlanDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<SubscriptionResponseDTO> {
    return await this.service.changePlan(req.user.id, body.productId);
  }

  @ApiOperation({ summary: "Cancel the authenticated user's subscription" })
  @ApiResponse({
    status: 200,
    description: 'Subscription canceled.',
    type: SubscriptionResponseDTO,
  })
  @ApiResponse({ status: 400, description: 'No active subscription.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @Patch('cancel')
  async cancel(
    @Request() req: AuthenticatedRequest,
  ): Promise<SubscriptionResponseDTO> {
    return await this.service.cancel(req.user.id);
  }

  @ApiOperation({
    summary: "Reactivate the authenticated user's canceled subscription",
  })
  @ApiResponse({
    status: 200,
    description: 'Subscription reactivated.',
    type: SubscriptionResponseDTO,
  })
  @ApiResponse({ status: 400, description: 'No subscription to reactivate.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @Patch('reactivate')
  async reactivate(
    @Request() req: AuthenticatedRequest,
  ): Promise<SubscriptionResponseDTO> {
    return await this.service.reactivate(req.user.id);
  }
}
