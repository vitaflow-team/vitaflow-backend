import { ApiProperty } from '@nestjs/swagger';

// Stored address as read back by GET /profile: every column is nullable in
// the database. Decorated for Swagger, never validated.
export class ProfileAddressResponseDTO {
  @ApiProperty({ nullable: true, type: String, example: 'Av. Paulista, 1000' })
  addressLine1: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Apto 12B' })
  addressLine2: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Bela Vista' })
  district: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'São Paulo' })
  city: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'SP' })
  region: string | null;

  @ApiProperty({ nullable: true, type: String, example: '01310-000' })
  postalCode: string | null;
}
