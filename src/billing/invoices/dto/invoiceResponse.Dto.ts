import { ApiProperty } from '@nestjs/swagger';
import { InvoiceStatus } from '@prisma/client';

export interface InvoiceResponseDTO {
  id: string;
  competenceYear: number;
  competenceMonth: number;
  amountCents: number;
  dueDate: string;
  status: InvoiceStatus;
  paidAt: string | null;
  paidAmountCents: number | null;
  manualNote: string | null;
  paymentUrl: string | null;
  canResendAt: string | null;
  // Not in the TechSpec's own DTO field list, but UT-052/UT-053 require the
  // response to say whether the link e-mail went out, so the professional
  // knows to copy the link by hand — added to satisfy that assigned case.
  // Only `create` sets this; other actions never send this e-mail, so it is
  // omitted there rather than carrying a meaningless value.
  emailSent?: boolean;
}

export class InvoiceResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 2026 }) competenceYear!: number;
  @ApiProperty({ example: 11 }) competenceMonth!: number;
  @ApiProperty({ example: 19990 }) amountCents!: number;
  @ApiProperty({ example: '2026-11-20' }) dueDate!: string;
  @ApiProperty({ enum: InvoiceStatus }) status!: string;
  @ApiProperty({ nullable: true }) paidAt!: string | null;
  @ApiProperty({ nullable: true }) paidAmountCents!: number | null;
  @ApiProperty({ nullable: true }) manualNote!: string | null;
  @ApiProperty({ nullable: true }) paymentUrl!: string | null;
  @ApiProperty({ nullable: true }) canResendAt!: string | null;
  @ApiProperty({ required: false }) emailSent?: boolean;
}
