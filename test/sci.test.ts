import { describe, expect, it } from 'vitest';
import { cleanRows, tableHTML, toCSV } from '../src/sci';

describe('the numbers view', () => {
  it('writes CSV that quotes what needs quoting', () => {
    expect(toCSV(['name', 'note'], [['Lac Léman', 'a "big" lake, Swiss'], ['X', null]])).toBe('name,note\nLac Léman,"a ""big"" lake, Swiss"\nX,\n');
  });
  it('drops empty values and keeps numbers readable', () => {
    expect(cleanRows([['a', null], ['b', ''], ['c', NaN], ['d', 1642.04], ['e', 0.123456]])).toEqual([['d', 1642], ['e', 0.1235]].map(([l, v]) => [l, v, undefined]));
  });
  it('escapes the table', () => {
    expect(tableHTML([['<b>', 'x & y', 'src']])).toContain('&lt;b&gt;');
  });
});
