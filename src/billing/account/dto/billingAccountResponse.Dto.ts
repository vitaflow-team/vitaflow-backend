import { ApiProperty } from '@nestjs/swagger';

export interface BillingAccountResponseDTO {
  premium: boolean;
  connected: boolean;
  status: 'NOT_CONNECTED' | 'CONNECTED' | 'RECONNECT_NEEDED';
  accountName: string | null;
  openInvoiceCount: number;
}

export class BillingAccountResponse {
  @ApiProperty({ example: true }) premium!: boolean;
  @ApiProperty({ example: true }) connected!: boolean;
  @ApiProperty({ enum: ['NOT_CONNECTED', 'CONNECTED', 'RECONNECT_NEEDED'] })
  status!: string;
  @ApiProperty({ example: 'Thiago Ramos', nullable: true }) accountName!:
    | string
    | null;
  @ApiProperty({ example: 0 }) openInvoiceCount!: number;
}
