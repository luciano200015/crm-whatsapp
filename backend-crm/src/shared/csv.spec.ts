import { csvCell, csvDocument, csvRow } from './csv';

describe('csv', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Pérez, Ana')).toBe('"Pérez, Ana"');
    expect(csvCell('dice "hola"')).toBe('"dice ""hola"""');
    expect(csvCell('uno\ndos')).toBe('"uno\ndos"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12.5)).toBe('12.5');
  });

  it('keeps spreadsheets from running formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell('+cmd|calc')).toBe("'+cmd|calc");
    expect(csvCell('-1+2')).toBe("'-1+2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
    // Plain numbers (phones, values) are data, not formulas.
    expect(csvCell('+59170000001')).toBe('+59170000001');
    expect(csvCell('-2')).toBe('-2');
    expect(csvCell(-2)).toBe('-2');
  });

  it('writes a BOM, a header and CRLF rows', () => {
    expect(csvDocument(['a', 'b'], [[1, 'x,y']])).toBe(
      '\uFEFFa,b\r\n1,"x,y"\r\n',
    );
    expect(csvRow(['a', undefined, 'c'])).toBe('a,,c');
  });
});
