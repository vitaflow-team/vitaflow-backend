import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';

export class ActiveDTO {
  @ApiProperty({
    description: 'Token for account activation.',
  })
  @IsNotEmpty({ message: 'Token is required.' })
  token: string;
}
