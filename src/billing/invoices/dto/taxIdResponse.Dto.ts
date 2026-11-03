import { ApiProperty } from '@nestjs/swagger';

export interface TaxIdResponseDTO {
  present: boolean;
  masked: string | null;
}

export class TaxIdResponse {
  @ApiProperty({ example: true }) present!: boolean;
  @ApiProperty({ example: '***.***.***-25', nullable: true }) masked!:
    | string
    | null;
}
