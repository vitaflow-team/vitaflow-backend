import { ApiProperty } from '@nestjs/swagger';
import { BackofficeTier } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class ChangeStaffTierDTO {
  @ApiProperty({
    description: 'New internal access tier.',
    enum: BackofficeTier,
    example: BackofficeTier.ADMIN,
  })
  @IsEnum(BackofficeTier)
  tier: BackofficeTier;
}
