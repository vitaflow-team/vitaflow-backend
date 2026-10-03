import { NormalizeEmail } from '@/utils/normalizeEmail';
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

export class AccountLookupQueryDTO {
  @ApiProperty({ example: 'diego.martins@exemplo.com' })
  @NormalizeEmail()
  @IsEmail({}, { message: 'email must be a valid email address.' })
  @MaxLength(254)
  email: string;
}
