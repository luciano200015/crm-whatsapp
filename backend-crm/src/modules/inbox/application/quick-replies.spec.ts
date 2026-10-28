import { normalizeShortcut, titleKey } from './quick-replies';

describe('quick replies', () => {
  it('derives a unique key from the title, without accents or emojis', () => {
    expect(titleKey('Lavadoras Monstruosas 🎃')).toBe('lavadoras-monstruosas');
    expect(titleKey('  Envío a domicilio  ')).toBe('envio-a-domicilio');
    expect(titleKey('🎃🎃')).toBeNull();
  });

  it('still accepts the old "/" shortcuts', () => {
    expect(normalizeShortcut('/Saludo')).toBe('saludo');
    expect(normalizeShortcut('con espacios')).toBeNull();
  });
});
