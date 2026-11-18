import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUrl, MaxLength } from 'class-validator';

export class DeviceEndpointDto {
  @ApiProperty({ description: 'Browser push subscription endpoint (HTTPS).' })
  @IsString()
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false })
  @MaxLength(2048)
  endpoint: string;
}
