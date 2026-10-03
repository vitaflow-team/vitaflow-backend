import { ApiProperty } from '@nestjs/swagger';
import { NotificationCategory } from '@prisma/client';

export class NotificationEntity {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: NotificationCategory })
  category: NotificationCategory;

  @ApiProperty()
  message: string;

  @ApiProperty({ required: false, nullable: true })
  link: string | null;

  @ApiProperty({ nullable: true })
  readAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}

export class UnreadCountEntity {
  @ApiProperty()
  count: number;
}

// One key per NotificationCategory — Swagger can't express a dynamic-key
// Record cleanly, so this documents the exact per-category shape returned.
export class NotificationPreferencesEntity {
  @ApiProperty()
  WORKOUT_REMINDER: boolean;

  @ApiProperty()
  CONSULTATION_REMINDER: boolean;

  @ApiProperty()
  MESSAGES: boolean;

  @ApiProperty()
  BILLING: boolean;

  @ApiProperty()
  PRODUCT_NEWS: boolean;

  @ApiProperty()
  CONNECTION_REQUEST: boolean;

  @ApiProperty()
  WORKOUT_PLAN: boolean;

  @ApiProperty()
  SCHEDULE_CHANGE: boolean;
}
