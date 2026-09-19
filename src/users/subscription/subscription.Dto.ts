import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

const SUBSCRIPTION_STATUSES = [
  'active',
  'trialing',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
] as const;

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
}

export class SyncSubscriptionDTO {
  @ApiProperty({ description: 'Stripe Customer id.' })
  @IsString()
  @IsNotEmpty({ message: 'stripeCustomerId is mandatory.' })
  stripeCustomerId: string;

  @ApiProperty({
    description:
      'Vita Flow user id — only needed the first time a customer is ' +
      'linked, before Users.stripeCustomerId is on record.',
    required: false,
  })
  @IsString()
  @IsOptional()
  userId?: string;

  @ApiProperty({
    description:
      'Stripe Price id currently active on the subscription, used to ' +
      'resolve the Vita Flow product. Explicit null means the ' +
      'subscription has no active price (it ended).',
    required: false,
    nullable: true,
  })
  @IsOptional()
  stripePriceId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  stripeSubscriptionId?: string | null;

  @ApiProperty({ enum: SUBSCRIPTION_STATUSES })
  @IsIn(SUBSCRIPTION_STATUSES)
  subscriptionStatus: string;

  @ApiProperty({ required: false, nullable: true })
  @IsISO8601()
  @IsOptional()
  subscriptionCancelAt?: string | null;
}
