import { NormalizeEmail } from '@/utils/normalizeEmail';
import { ApiProperty } from '@nestjs/swagger';
import { AcademiaInvitationKind } from '@prisma/client';
import { IsEmail, IsEnum, MaxLength } from 'class-validator';

export class InviteAcademiaMemberDTO {
  @ApiProperty({
    description: 'Email of the person being invited.',
    example: 'educador@example.com',
  })
  @NormalizeEmail()
  @IsEmail({}, { message: 'email must be a valid email address.' })
  @MaxLength(254)
  email: string;

  @ApiProperty({
    description: 'Whether this invites an employed educator or a receptionist.',
    enum: AcademiaInvitationKind,
    example: AcademiaInvitationKind.EMPLOYMENT,
  })
  @IsEnum(AcademiaInvitationKind)
  kind: AcademiaInvitationKind;
}
