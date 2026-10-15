import { NormalizeEmail } from '@/utils/normalizeEmail';
import { ApiProperty } from '@nestjs/swagger';
import { BackofficeTier } from '@prisma/client';
import { IsEmail, IsEnum, MaxLength } from 'class-validator';

export class InviteStaffDTO {
  @ApiProperty({
    description: 'Email of the colleague being invited to internal access.',
    example: 'equipe@vitaflow.com',
  })
  @NormalizeEmail()
  @IsEmail({}, { message: 'email must be a valid email address.' })
  @MaxLength(254)
  email: string;

  @ApiProperty({
    description: 'Internal access tier to grant.',
    enum: BackofficeTier,
    example: BackofficeTier.EQUIPE,
  })
  @IsEnum(BackofficeTier)
  tier: BackofficeTier;
}
