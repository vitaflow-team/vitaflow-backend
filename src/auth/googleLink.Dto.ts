import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class GoogleLinkDTO {
  @ApiProperty({ description: 'Google-issued ID token.' })
  @IsString()
  @IsNotEmpty()
  idToken: string;

  @ApiProperty({ description: 'Intent returned by /auth/google/link-intent.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  intent: string;
}
