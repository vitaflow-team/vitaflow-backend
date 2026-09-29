import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { SUBSCRIPTION_STATUSES } from '../subscriptionStatuses';

export class UpdateSubscriptionDTO {
  @ApiProperty({
    description:
      'Vita Flow product id the authenticated user just subscribed to.',
    example: 'cuid-product-456',
  })
  @IsString()
  @IsNotEmpty({ message: 'productId is mandatory.' })
  productId: string;

  @ApiProperty({ description: 'Stripe Customer id.' })
  @IsString()
  @IsNotEmpty({ message: 'stripeCustomerId is mandatory.' })
  stripeCustomerId: string;

  @ApiProperty({ description: 'Stripe Subscription id.' })
  @IsString()
  @IsNotEmpty({ message: 'stripeSubscriptionId is mandatory.' })
  stripeSubscriptionId: string;

  @ApiProperty({
    description: 'Stripe subscription status at the time of this call.',
    enum: SUBSCRIPTION_STATUSES,
  })
  @IsIn(SUBSCRIPTION_STATUSES)
  subscriptionStatus: string;

  @ApiProperty({
    description:
      'ISO timestamp when a cancel-at-period-end takes effect, or null ' +
      'to clear a scheduled cancellation (reactivation).',
    required: false,
    nullable: true,
  })
  @IsISO8601()
  @IsOptional()
  subscriptionCancelAt?: string | null;

  @ApiProperty({
    description:
      'ISO timestamp when the current billing period ends, or null to ' +
      'clear it. Omit the field entirely to leave the stored value ' +
      'untouched.',
    required: false,
    nullable: true,
  })
  @IsISO8601()
  @IsOptional()
  subscriptionCurrentPeriodEnd?: string | null;
}
