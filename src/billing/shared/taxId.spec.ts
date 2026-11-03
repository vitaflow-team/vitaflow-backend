import { maskTaxId, validateTaxId } from './taxId';

describe('tax number (UT-004, UT-005)', () => {
  it('accepts a valid CPF in both formats and a valid CNPJ', () => {
    expect(validateTaxId('529.982.247-25')).toEqual({
      kind: 'CPF',
      digits: '52998224725',
    });
    expect(validateTaxId('52998224725')).toEqual({
      kind: 'CPF',
      digits: '52998224725',
    });
    expect(validateTaxId('11.222.333/0001-81')).toEqual({
      kind: 'CNPJ',
      digits: '11222333000181',
    });
  });

  it('rejects a wrong check digit, repeated digits, wrong lengths, letters and blanks', () => {
    for (const value of [
      '529.982.247-26',
      '111.111.111-11',
      '1234567890',
      'abcdefghijk',
      '11.222.333/0001-82',
      '',
      '   ',
    ]) {
      expect(() => validateTaxId(value)).toThrow();
    }
  });

  it('masks a CPF and a CNPJ, showing only the last two digits', () => {
    expect(maskTaxId({ kind: 'CPF', digits: '52998224725' })).toBe(
      '***.***.***-25',
    );
    expect(maskTaxId({ kind: 'CNPJ', digits: '11222333000181' })).toBe(
      '**.***.***/****-81',
    );
  });
});
