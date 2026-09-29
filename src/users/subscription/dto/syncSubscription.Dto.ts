import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { SUBSCRIPTION_STATUSES } from '../subscriptionStatuses';

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
  @IsString()
  @IsOptional()
  stripePriceId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsString()
  @IsOptional()
  stripeSubscriptionId?: string | null;

  @ApiProperty({ enum: SUBSCRIPTION_STATUSES })
  @IsIn(SUBSCRIPTION_STATUSES)
  subscriptionStatus: string;

  @ApiProperty({ required: false, nullable: true })
  @IsISO8601()
  @IsOptional()
  subscriptionCancelAt?: string | null;

  @ApiProperty({
    description:
      'ISO timestamp when the current billing period ends. Omitted means ' +
      "the event didn't carry one — the stored value is left unchanged. " +
      'Explicit null clears it (sent only when the subscription is ' +
      'deleted).',
    required: false,
    nullable: true,
  })
  @IsISO8601()
  @IsOptional()
  subscriptionCurrentPeriodEnd?: string | null;
}
