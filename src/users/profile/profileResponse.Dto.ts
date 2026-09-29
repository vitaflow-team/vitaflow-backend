import { ApiProperty } from '@nestjs/swagger';
import { ProductType } from '@prisma/client';
import { ProfileAddressResponseDTO } from './profileAddressResponse.Dto';

// Response of GET /profile. It reaches client components, so it never
// carries the password hash or the raw Stripe identifiers. Decorated for
// Swagger, never validated.
export class ProfileResponseDTO {
  @ApiProperty({ example: 'cuid-user-456' })
  id: string;

  @ApiProperty({ example: 'John Doe' })
  name: string;

  @ApiProperty({ example: 'johndoe@example.com' })
  email: string;

  @ApiProperty({ nullable: true, type: Date, example: '1990-05-20' })
  birthDate: Date | null;

  @ApiProperty({ nullable: true, type: String, description: 'Signed URL.' })
  avatar: string | null;

  @ApiProperty({ nullable: true, type: String, example: '(11) 98888-7777' })
  phone: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'cuid-product-123' })
  productId: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Gratuito' })
  productName: string | null;

  @ApiProperty({ nullable: true, enum: ProductType })
  productType: ProductType | null;

  @ApiProperty({ nullable: true, type: String, example: 'cuid-group-123' })
  productGroupId: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'active' })
  subscriptionStatus: string | null;

  @ApiProperty({ nullable: true, type: Date })
  subscriptionCancelAt: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  subscriptionCurrentPeriodEnd: Date | null;

  @ApiProperty({
    nullable: true,
    type: Date,
    description: 'Date the paid plan ends; null for Gratuito or no end date.',
  })
  expiresAt: Date | null;

  @ApiProperty({ example: true })
  autoRenew: boolean;

  @ApiProperty({ example: false })
  hasStripeCustomer: boolean;

  @ApiProperty({ example: 0 })
  clientsCount: number;

  @ApiProperty({ type: ProfileAddressResponseDTO, nullable: true })
  address: ProfileAddressResponseDTO | null;
}
