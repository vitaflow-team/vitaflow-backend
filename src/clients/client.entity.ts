import { ApiProperty } from '@nestjs/swagger';
import { Client } from '@prisma/client';

export class ClientEntity implements Client {
  @ApiProperty({
    description: 'Unique identifier of the client',
    example: 'uuid-string',
  })
  id: string;

  @ApiProperty({
    description: 'Name of the client',
    example: 'John Doe',
  })
  name: string;

  @ApiProperty({
    description: 'Phone number of the client',
    example: '(11) 99999-9999',
  })
  phone: string;

  @ApiProperty({
    description: 'Email of the client',
    example: 'client@example.com',
  })
  email: string;

  @ApiProperty({
    description: 'User ID associated with the client (optional)',
    example: 'user-uuid-string',
    required: false,
    nullable: true,
  })
  userId: string | null;

  @ApiProperty({
    description: 'Birth date of the client',
    example: '1990-01-01',
    required: false,
    nullable: true,
  })
  birthDate: Date | null;

  @ApiProperty({
    description: 'ID of the professional managing this client',
    example: 'professional-uuid-string',
  })
  professionalId: string;

  @ApiProperty({
    description: 'Date when the client was created',
    example: '2023-01-01T00:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Date when the client was last updated',
    example: '2023-01-01T00:00:00.000Z',
  })
  updatedAt: Date;
}
