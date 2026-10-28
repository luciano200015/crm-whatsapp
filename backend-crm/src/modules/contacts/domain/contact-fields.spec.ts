import {
  cleanOptions,
  INVALID,
  fieldKey,
  parseFieldValue,
  type FieldDefinition,
} from './contact-fields';

const field = (
  type: FieldDefinition['type'],
  options: string[] = [],
): FieldDefinition => ({ key: 'x', label: 'X', type, options });

describe('contact fields', () => {
  it('derives a stable key from the label', () => {
    expect(fieldKey('Fecha de nacimiento')).toBe('fecha_de_nacimiento');
    expect(fieldKey('  Ciudad / País ')).toBe('ciudad_pais');
    expect(fieldKey('🎉')).toBe('');
  });

  it('leaves empty values out', () => {
    expect(parseFieldValue(field('TEXT'), '  ')).toBeNull();
    expect(parseFieldValue(field('NUMBER'), null)).toBeNull();
  });

  it('reads numbers as spreadsheets write them', () => {
    expect(parseFieldValue(field('NUMBER'), '1.234,5')).toBe(1234.5);
    expect(parseFieldValue(field('NUMBER'), '1,234.5')).toBe(1234.5);
    expect(parseFieldValue(field('NUMBER'), 42)).toBe(42);
    expect(parseFieldValue(field('NUMBER'), 'doce')).toBe(INVALID);
  });

  it('stores dates as YYYY-MM-DD', () => {
    expect(parseFieldValue(field('DATE'), '2026-02-28')).toBe('2026-02-28');
    expect(parseFieldValue(field('DATE'), '5/3/2026')).toBe('2026-03-05');
    expect(parseFieldValue(field('DATE'), '2026-02-30')).toBe(INVALID);
  });

  it('matches list options ignoring case and accents', () => {
    const city = field('SELECT', ['La Paz', 'Santa Cruz']);
    expect(parseFieldValue(city, 'la paz')).toBe('La Paz');
    expect(parseFieldValue(city, 'Oruro')).toBe(INVALID);
    expect(cleanOptions([' A ', 'a', '', 'Á', 'B'])).toEqual(['A', 'B']);
  });
});
