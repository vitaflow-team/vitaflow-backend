import { Invoice } from '@prisma/client';
import { dateOnlyKey } from './dates';

type InvoicePeriod = Pick<
  Invoice,
  'competenceMonth' | 'competenceYear' | 'dueDate'
>;

// Sent to the student when the invoice is created and when it becomes
// overdue — names the professional who issued it (ADR-003 decisions 2, 3).
export function newInvoiceMessage(
  invoice: InvoicePeriod,
  professionalName: string,
): string {
  return `${professionalName} gerou uma nova cobrança de ${invoice.competenceMonth}/${invoice.competenceYear}, com vencimento em ${dateOnlyKey(invoice.dueDate)}.`;
}

export function overdueInvoiceMessageForStudent(
  invoice: InvoicePeriod,
  professionalName: string,
): string {
  return `Sua cobrança de ${invoice.competenceMonth}/${invoice.competenceYear} com ${professionalName} está atrasada, vencimento em ${dateOnlyKey(invoice.dueDate)}.`;
}

// Sent to the professional when the invoice becomes overdue or is paid
// through the gateway (ADR-003 decision 3) — names the student.
export function overdueInvoiceMessageForProfessional(
  invoice: InvoicePeriod,
  studentName: string,
): string {
  return `A cobrança de ${invoice.competenceMonth}/${invoice.competenceYear} de ${studentName} está atrasada, vencimento em ${dateOnlyKey(invoice.dueDate)}.`;
}

export function paidInvoiceMessageForProfessional(
  invoice: InvoicePeriod,
  studentName: string,
): string {
  return `${studentName} pagou a cobrança de ${invoice.competenceMonth}/${invoice.competenceYear}, vencimento em ${dateOnlyKey(invoice.dueDate)}.`;
}
