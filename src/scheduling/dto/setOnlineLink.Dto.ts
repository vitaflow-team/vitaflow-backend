import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

// No URL validation, by design (ADR-001): the professional is responsible
// for providing a working link, and Vitaflow stores/returns it as-is.
export class SetOnlineLinkDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  link: string;
}
