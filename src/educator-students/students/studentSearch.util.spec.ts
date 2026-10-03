import { foldText, matchesSearch } from './studentSearch.util';

const student = { name: 'João Álvares', email: 'joao.alvares@gmail.com' };

describe('studentSearch util', () => {
  it('UT-017 matches ignoring case and accents', () => {
    expect(matchesSearch(student, 'joao')).toBe(true);
    expect(matchesSearch(student, 'ALVARES')).toBe(true);
    expect(matchesSearch(student, 'álv')).toBe(true);
    expect(matchesSearch(student, 'maria')).toBe(false);
  });

  it('UT-018 treats a blank term as no filter and trims the term', () => {
    expect(matchesSearch(student, '   ')).toBe(true);
    expect(matchesSearch(student, undefined)).toBe(true);
    expect(matchesSearch(student, ' joao ')).toBe(true);
  });

  it.each(['%', '_', "'; DROP", '<script>'])(
    'UT-019 treats %p as plain text, never as a pattern',
    (term) => {
      expect(matchesSearch(student, term)).toBe(false);
      expect(
        matchesSearch({ name: `A ${term} B`, email: 'a@x.com' }, term),
      ).toBe(true);
    },
  );

  it('UT-020 matches part of the e-mail', () => {
    expect(matchesSearch(student, '@gmail')).toBe(true);
    expect(matchesSearch(student, '@outlook')).toBe(false);
  });

  it('folds accents and case consistently', () => {
    expect(foldText('  ÁÉÎõü  ')).toBe('aeiou');
  });
});
