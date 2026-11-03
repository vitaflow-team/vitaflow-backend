import { CodedError } from '@/common/errors/codedError';

export interface TaxId {
  kind: 'CPF' | 'CNPJ';
  digits: string;
}

const ALLOWED_CHARACTERS = /^[\d.\-/\s]+$/;
const INVALID = 'Informe um CPF ou CNPJ válido.';

function checkDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce(
    (total, weight, index) => total + Number(digits[index]) * weight,
    0,
  );
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function isValidCpf(digits: string): boolean {
  if (/^(\d)\1+$/.test(digits)) return false;
  const first = checkDigit(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(digits, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(digits[9]) && second === Number(digits[10]);
}

function isValidCnpj(digits: string): boolean {
  if (/^(\d)\1+$/.test(digits)) return false;
  const first = checkDigit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(digits[12]) && second === Number(digits[13]);
}

export function validateTaxId(raw: unknown): TaxId {
  if (
    typeof raw !== 'string' ||
    raw.trim().length === 0 ||
    !ALLOWED_CHARACTERS.test(raw.trim())
  ) {
    throw new CodedError(INVALID, 400, 'tax_id_invalid');
  }
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && isValidCpf(digits))
    return { kind: 'CPF', digits };
  if (digits.length === 14 && isValidCnpj(digits))
    return { kind: 'CNPJ', digits };
  throw new CodedError(INVALID, 400, 'tax_id_invalid');
}

export function maskTaxId(tax: TaxId): string {
  const last = tax.digits.slice(-2);
  return tax.kind === 'CPF' ? `***.***.***-${last}` : `**.***.***/****-${last}`;
}
