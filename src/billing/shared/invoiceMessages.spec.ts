import { Invoice } from '@prisma/client';
import {
  newInvoiceMessage,
  overdueInvoiceMessageForProfessional,
  overdueInvoiceMessageForStudent,
  paidInvoiceMessageForProfessional,
} from './invoiceMessages';

const invoice = {
  competenceMonth: 11,
  competenceYear: 2026,
  dueDate: new Date('2026-11-25T00:00:00.000Z'),
} as Pick<Invoice, 'competenceMonth' | 'competenceYear' | 'dueDate'>;

const FORBIDDEN = [
  /\d{3}\.\d{3}\.\d{3}-\d{2}/, // CPF
  /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/, // CNPJ
  /asaas/i,
  /http/i,
  /chave|key|token/i,
];

describe('invoice notification messages (UT-095)', () => {
  it('the new-invoice message names the professional and states the month and due date', () => {
    const message = newInvoiceMessage(invoice, 'Thiago Ramos');

    expect(message).toContain('Thiago Ramos');
    expect(message).toContain('11/2026');
    expect(message).toContain('2026-11-25');
    FORBIDDEN.forEach((pattern) => expect(message).not.toMatch(pattern));
  });

  it('the student-facing overdue message names the professional and states the month and due date', () => {
    const message = overdueInvoiceMessageForStudent(invoice, 'Thiago Ramos');

    expect(message).toContain('Thiago Ramos');
    expect(message).toContain('11/2026');
    expect(message).toContain('2026-11-25');
    FORBIDDEN.forEach((pattern) => expect(message).not.toMatch(pattern));
  });

  it('the professional-facing overdue message names the student and states the month and due date', () => {
    const message = overdueInvoiceMessageForProfessional(
      invoice,
      'Maria Silva',
    );

    expect(message).toContain('Maria Silva');
    expect(message).toContain('11/2026');
    expect(message).toContain('2026-11-25');
    FORBIDDEN.forEach((pattern) => expect(message).not.toMatch(pattern));
  });

  it('the paid message names the student and states the month and the payment date', () => {
    const message = paidInvoiceMessageForProfessional(invoice, 'Maria Silva');

    expect(message).toContain('Maria Silva');
    expect(message).toContain('11/2026');
    expect(message).toContain('2026-11-25');
    FORBIDDEN.forEach((pattern) => expect(message).not.toMatch(pattern));
  });
});
