import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class PreviewStaffInvitationDTO {
  @ApiProperty({ description: 'Token from the staff invitation link.' })
  @IsString()
  @IsNotEmpty({ message: 'Token is required.' })
  @MaxLength(512)
  token: string;
}
