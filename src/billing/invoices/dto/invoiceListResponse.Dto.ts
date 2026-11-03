import type { FinancialSituation } from '@/billing/shared/invoiceTransitions';
import { ApiProperty } from '@nestjs/swagger';
import { InvoiceResponse, InvoiceResponseDTO } from './invoiceResponse.Dto';
import { TaxIdResponse, TaxIdResponseDTO } from './taxIdResponse.Dto';

export type { FinancialSituation };

export interface InvoiceListResponseDTO {
  items: InvoiceResponseDTO[];
  total: number;
  page: number;
  pageSize: number;
  situation: FinancialSituation;
  taxId: TaxIdResponseDTO;
  gateway: { connected: boolean; premium: boolean };
}

export class InvoiceListResponse {
  @ApiProperty({ type: [InvoiceResponse] }) items!: InvoiceResponse[];
  @ApiProperty({ example: 3 }) total!: number;
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: 20 }) pageSize!: number;
  @ApiProperty({ enum: ['OVERDUE', 'PENDING', 'UP_TO_DATE', 'NONE'] })
  situation!: string;
  @ApiProperty({ type: TaxIdResponse }) taxId!: TaxIdResponse;
  @ApiProperty({
    example: { connected: true, premium: true },
  })
  gateway!: { connected: boolean; premium: boolean };
}
