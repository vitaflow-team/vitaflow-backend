import { ApiProperty } from '@nestjs/swagger';

// Response of a subscription update or webhook sync. Decorated for Swagger,
// never validated.
export class SubscriptionResponseDTO {
  @ApiProperty({ example: 'cuid-user-456' })
  id: string;

  @ApiProperty({ nullable: true, type: String, example: 'cuid-product-123' })
  productId: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Premium' })
  productName: string | null;

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
