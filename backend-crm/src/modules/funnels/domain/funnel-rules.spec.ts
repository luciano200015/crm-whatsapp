import { centsToText, sameName, visibleStageIds } from './funnel-rules';

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
