import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ActiveDTO {
  @ApiProperty({
    description: 'Token for account activation.',
  })
  @IsString()
  @IsNotEmpty({ message: 'Token is required.' })
  token: string;
}
