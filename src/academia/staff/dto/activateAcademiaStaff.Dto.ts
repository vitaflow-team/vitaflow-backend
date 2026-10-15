import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PASSWORD_MAX_BYTES } from '@/utils/password.hash';

export class ActivateAcademiaStaffDTO {
  @ApiProperty({ description: 'Raw activation token from the email link.' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ description: 'New password for this receptionist account.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_BYTES)
  password: string;
}
