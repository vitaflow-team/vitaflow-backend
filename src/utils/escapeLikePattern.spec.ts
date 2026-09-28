import { escapeLikePattern } from './escapeLikePattern';

describe('escapeLikePattern', () => {
  it('escapes LIKE wildcards and the escape character itself', () => {
    expect(escapeLikePattern('a_b%c\\d@example.com')).toBe(
      'a\\_b\\%c\\\\d@example.com',
    );
  });

  it('leaves an ordinary email unchanged', () => {
    expect(escapeLikePattern('jane.doe+tag@example.com')).toBe(
      'jane.doe+tag@example.com',
    );
  });
});
