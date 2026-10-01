import { ApiProperty } from '@nestjs/swagger';
import { ConnectionRequestStatus } from '@prisma/client';

export class ConnectionRequestEntity {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Requesting user id.' })
  userId: string;

  @ApiProperty({
    description:
      'Requesting user name, for the professional’s incoming queue (US-007.AC-1).',
  })
  userName: string;

  @ApiProperty({ description: 'Professional id.' })
  professionalId: string;

  @ApiProperty({
    description:
      'Professional name, for the user’s own-requests view (US-005.AC-1).',
  })
  professionalName: string;

  @ApiProperty({ enum: ConnectionRequestStatus })
  status: ConnectionRequestStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ nullable: true })
  decidedAt: Date | null;
}
