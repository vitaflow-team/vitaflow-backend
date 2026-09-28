import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class GoogleSignInDTO {
  @ApiProperty({ description: 'Google-issued ID token.' })
  @IsString()
  @IsNotEmpty()
  idToken: string;
}
