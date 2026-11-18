import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class PushKeysDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  p256dh: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  auth: string;
}
