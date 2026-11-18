import type { InvoiceResponseDTO } from '@/billing/invoices/dto/invoiceResponse.Dto';
import type { StudentAccessPlan } from '@prisma/client';
import type { RecurringBillingResponseDTO } from './recurringBillingResponse.Dto';

export interface AssignAccessPlanResponseDTO {
  plan: StudentAccessPlan;
  billing: RecurringBillingResponseDTO | null;
  firstInvoice: InvoiceResponseDTO | null;
}
