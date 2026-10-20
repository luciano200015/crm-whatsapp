import { sanitizeAuditMetadata } from './audit-sanitizer';

describe('sanitizeAuditMetadata', () => {
  it('drops sensitive keys at any depth', () => {
    const result = sanitizeAuditMetadata({
      email: 'ana@example.com',
      password: 'hunter2hunter2',
      refreshToken: 'abc',
      nested: { passwordHash: 'x', Authorization: 'Bearer y', ok: 1 },
      list: [{ cookie: 'crm_rt=z', keep: true }],
    });

    expect(result).toEqual({
      email: 'ana@example.com',
      nested: { ok: 1 },
      list: [{ keep: true }],
    });
    expect(JSON.stringify(result)).not.toMatch(/hunter2|Bearer|crm_rt/);
  });

  it('truncates long strings and deep nesting', () => {
    const deep = { a: { b: { c: { d: { e: { f: 'too deep' } } } } } };
    const result = sanitizeAuditMetadata({ long: 'x'.repeat(1000), deep });

    expect((result.long as string).length).toBeLessThanOrEqual(501);
    expect(JSON.stringify(result)).toContain('[truncated]');
    expect(JSON.stringify(result)).not.toContain('too deep');
  });

  it('serializes dates and drops functions', () => {
    const result = sanitizeAuditMetadata({
      at: new Date('2026-01-01T00:00:00Z'),
      fn: () => 1,
    });
    expect(result).toEqual({ at: '2026-01-01T00:00:00.000Z', fn: undefined });
  });
});
