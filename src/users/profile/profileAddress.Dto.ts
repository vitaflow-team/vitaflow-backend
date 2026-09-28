import { ApiProperty } from '@nestjs/swagger';

export class ProfileAddressDTO {
  @ApiProperty({ example: 'Av. Paulista, 1000' })
  addressLine1: string;

  @ApiProperty({ example: 'Apto 12B', required: false })
  addressLine2?: string;

  @ApiProperty({ example: 'Bela Vista' })
  district: string;

  @ApiProperty({ example: 'São Paulo' })
  city: string;

  @ApiProperty({ example: 'SP' })
  region: string;

  @ApiProperty({ example: '01310-000' })
  postalCode: string;
}
