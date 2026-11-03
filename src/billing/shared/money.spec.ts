import { CodedError } from '@/common/errors/codedError';
import { centsToDecimal, parseReaisToCents } from './money';

describe('money (UT-001)', () => {
  it('converts accepted amounts to whole cents', () => {
    expect(parseReaisToCents(19.9)).toBe(1990);
    expect(parseReaisToCents('19.90')).toBe(1990);
    expect(parseReaisToCents(5)).toBe(500);
    expect(parseReaisToCents(50000)).toBe(5_000_000);
  });

  it('rejects amounts outside the range or with more than two decimals, naming the range', () => {
    for (const value of [4.99, 50000.01, 19.999, -5, 0, 'abc', NaN]) {
      let error: unknown;
      try {
        parseReaisToCents(value);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(CodedError);
      expect((error as CodedError).message).toContain('R$ 5,00');
      expect((error as CodedError).message).toContain('R$ 50.000,00');
    }
  });

  it('converts cents to a decimal value for the gateway', () => {
    expect(centsToDecimal(1990)).toBe(19.9);
    expect(centsToDecimal(500)).toBe(5);
  });
});
