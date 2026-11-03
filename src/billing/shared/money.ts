import { CodedError } from '@/common/errors/codedError';
import { BILLING_LIMITS } from './billingLimits';

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

function formatReais(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function parseReaisToCents(input: unknown): number {
  const range = `Informe um valor entre R$ ${formatReais(BILLING_LIMITS.amountMinCents)} e R$ ${formatReais(BILLING_LIMITS.amountMaxCents)}.`;
  const text = typeof input === 'number' ? String(input) : input;

  if (typeof text !== 'string' || !AMOUNT_PATTERN.test(text.trim())) {
    throw new CodedError(range, 400, 'invoice_invalid');
  }

  const [whole, fraction = ''] = text.trim().split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (
    cents < BILLING_LIMITS.amountMinCents ||
    cents > BILLING_LIMITS.amountMaxCents
  ) {
    throw new CodedError(range, 400, 'invoice_invalid');
  }
  return cents;
}

export function centsToDecimal(cents: number): number {
  return Number((cents / 100).toFixed(2));
}
