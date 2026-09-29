import { ApiProperty } from '@nestjs/swagger';
import { ProfileAddressDTO } from './profileAddress.Dto';

// Response of POST /profile: named fields only, never the password hash or
// the Stripe identifiers. Decorated for Swagger, never validated.
export class ProfileUpdateResponseDTO {
  @ApiProperty({ example: 'cuid-user-456' })
  id: string;

  @ApiProperty({ example: 'John Doe' })
  name: string;

  @ApiProperty({ example: 'johndoe@example.com' })
  email: string;

  @ApiProperty({ nullable: true, type: Date, example: '1990-05-20' })
  birthDate: Date | null;

  @ApiProperty({ nullable: true, type: String })
  avatar: string | null;

  @ApiProperty({ nullable: true, type: String, example: '(11) 98888-7777' })
  phone: string | null;

  @ApiProperty({ example: true })
  active: boolean;

  @ApiProperty({ nullable: true, type: String, example: 'cuid-product-123' })
  productId: string | null;

  @ApiProperty({ example: '2025-02-25T01:25:13.248Z' })
  createdAt: Date;

  @ApiProperty({ example: '2025-02-25T01:25:13.248Z' })
  updatedAt: Date;

  @ApiProperty({ type: ProfileAddressDTO, nullable: true })
  address: ProfileAddressDTO | null;
}
