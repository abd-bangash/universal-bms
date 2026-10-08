import { csvCell, csvLine } from '../csv';

describe('csvCell', () => {
  it('leaves plain text and numbers alone', () => {
    expect(csvCell('Sofa')).toBe('Sofa');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell('-1200.50')).toBe('-1200.50'); // a real negative amount stays a number
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
  it('quotes cells with commas, quotes and line breaks, doubling the quotes', () => {
    expect(csvCell('Table, large')).toBe('"Table, large"');
    expect(csvCell('5" nail')).toBe('"5"" nail"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });
  it('defuses spreadsheet formulas', () => {
    for (const evil of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '=HYPERLINK("http://x")']) {
      expect(csvCell(evil).replace(/^"/, '').startsWith("'")).toBe(true);
    }
  });
  it('ends each line with CRLF', () => {
    expect(csvLine(['a', 'b,c'])).toBe('a,"b,c"\r\n');
  });
});
