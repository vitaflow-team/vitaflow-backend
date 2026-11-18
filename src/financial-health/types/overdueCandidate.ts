import type { InvoiceStatus } from '@prisma/client';

// The two fields the overdue rule reads. `dueDate` is a calendar date key.
export interface OverdueCandidate {
  status: InvoiceStatus;
  dueDate: string;
}
