import { csvCell, csvDocument, csvRow } from './csv';
import { centsToText, sameName, visibleStageIds } from './funnel-rules';

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

describe('funnel rules', () => {
  it('shows every stage without privileges, or to those who manage', () => {
    const stages = ['s1', 's2', 's3'];
    expect(visibleStageIds(stages, [], false)).toEqual(stages);
    expect(visibleStageIds(stages, ['s3', 's1'], false)).toEqual(['s1', 's3']);
    expect(visibleStageIds(stages, ['s3'], true)).toEqual(stages);
  });

  it('compares names without case or accents', () => {
    expect(sameName('Atención  al cliente', 'atencion al CLIENTE')).toBe(true);
    expect(sameName('Ventas', 'Venta')).toBe(false);
  });

  it('writes cents as plain decimals', () => {
    expect(centsToText(0)).toBe('0.00');
    expect(centsToText(5)).toBe('0.05');
    expect(centsToText(123456)).toBe('1234.56');
  });
});
