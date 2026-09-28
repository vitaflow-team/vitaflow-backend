import { ApiProperty } from '@nestjs/swagger';

// Response of GET /users/subscription. It carries the Stripe identifiers, so
// it is for server-to-server use only. Decorated for Swagger, never
// validated.
export class SubscriptionStateResponseDTO {
  @ApiProperty({ nullable: true, type: String, example: 'cuid-product-123' })
  productId: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'cus_123' })
  stripeCustomerId: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'sub_123' })
  stripeSubscriptionId: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'active' })
  subscriptionStatus: string | null;

  @ApiProperty({ nullable: true, type: Date })
  subscriptionCancelAt: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  subscriptionCurrentPeriodEnd: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  expiresAt: Date | null;

  @ApiProperty({ example: true })
  autoRenew: boolean;
}
