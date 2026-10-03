import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class SetFixedSessionLinkDTO {
  @ApiProperty({
    maxLength: 500,
    description: 'http or https link for this one session.',
  })
  @IsString()
  @MaxLength(500)
  link: string;
}
