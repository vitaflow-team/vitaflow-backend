import { ApiProperty } from '@nestjs/swagger';

// Response of sign-up and activation: named fields only, never the password
// hash. Decorated for Swagger, never validated.
export class AccountResponseDTO {
  @ApiProperty({ example: 'cuid-user-456' })
  id: string;

  @ApiProperty({ example: 'John Doe' })
  name: string;

  @ApiProperty({ example: 'johndoe@example.com' })
  email: string;

  @ApiProperty({ nullable: true, type: String, example: null })
  avatar: string | null;

  @ApiProperty({ example: false })
  active: boolean;

  @ApiProperty({ nullable: true, type: String, example: null })
  phone: string | null;

  @ApiProperty({ nullable: true, type: Date, example: null })
  birthDate: Date | null;

  @ApiProperty({ nullable: true, type: String, example: 'cuid-product-123' })
  productId: string | null;

  @ApiProperty({ nullable: true, type: Date })
  termsAcceptedAt: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  healthDataConsentAt: Date | null;

  @ApiProperty({ example: '2025-02-25T01:25:13.248Z' })
  createdAt: Date;

  @ApiProperty({ example: '2025-02-25T01:25:13.248Z' })
  updatedAt: Date;
}
