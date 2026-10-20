import { normalizePhone, toWhatsAppId } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['+591 71234567', '+59171234567'],
    ['59171234567', '+59171234567'],
    ['0059171234567', '+59171234567'],
    ['+1 (415) 555-2671', '+14155552671'],
    ['  +34 612 34 56 78 ', '+34612345678'],
  ])('normalizes %p to E.164', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['', 'abc', '+12', '123'])('rejects %p', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('converts E.164 to a WhatsApp id', () => {
    expect(toWhatsAppId('+59171234567')).toBe('59171234567');
  });
});
