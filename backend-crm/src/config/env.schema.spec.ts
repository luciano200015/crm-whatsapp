import { generateKeyPairSync } from 'node:crypto';
import { validateEnv } from './env.schema';

const SECRET = 'sup3r-s3cret-value';

const keys = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const b64 = (pem: string) => Buffer.from(pem).toString('base64');

const base = {
  JWT_PRIVATE_KEY: b64(keys.privateKey),
  JWT_PUBLIC_KEY: b64(keys.publicKey),
  TOKEN_HASH_SECRET: 'x'.repeat(48),
  NODE_ENV: 'development',
  APP_URL: 'http://localhost:3000',
  CORS_ORIGINS: 'http://localhost:5173, http://localhost:4200',
  DATABASE_URL: `postgresql://crm:${SECRET}@localhost:5433/crm`,
  MONGODB_URI: `mongodb://crm:${SECRET}@localhost:27018/crm?authSource=admin`,
  COOKIE_SECURE: 'false',
};

describe('validateEnv', () => {
  it('parses and coerces a valid development environment', () => {
    const env = validateEnv(base);

    expect(env.PORT).toBe(3000);
    expect(env.CORS_ORIGINS).toEqual([
      'http://localhost:5173',
      'http://localhost:4200',
    ]);
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.SWAGGER_ENABLED).toBe(true);
    expect(env.COOKIE_SAMESITE).toBe('strict');
  });

  it('fails when a required variable is missing', () => {
    const { DATABASE_URL: _omitted, ...rest } = base;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('decodes the base64 PEM keys and rejects garbage', () => {
    const env = validateEnv(base);
    expect(env.JWT_PRIVATE_KEY).toContain('-----BEGIN PRIVATE KEY-----');
    expect(env.JWT_PUBLIC_KEY).toContain('-----BEGIN PUBLIC KEY-----');

    expect(() => validateEnv({ ...base, JWT_PUBLIC_KEY: 'change-me' })).toThrow(
      /JWT_PUBLIC_KEY/,
    );
  });

  it('requires a long TOKEN_HASH_SECRET', () => {
    expect(() => validateEnv({ ...base, TOKEN_HASH_SECRET: 'short' })).toThrow(
      /TOKEN_HASH_SECRET/,
    );
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() =>
      validateEnv({ ...base, DATABASE_URL: 'mysql://localhost/crm' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('never includes variable values in the error message', () => {
    const invalid = {
      ...base,
      DATABASE_URL: `mysql://crm:${SECRET}@localhost/crm`,
    };
    let message = '';
    try {
      validateEnv(invalid);
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).not.toContain(SECRET);
  });

  describe('production rules', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      COOKIE_SECURE: 'true',
    };

    it('accepts a hardened production environment and disables Swagger by default', () => {
      expect(validateEnv(production).SWAGGER_ENABLED).toBe(false);
    });

    it('requires secure cookies', () => {
      expect(() =>
        validateEnv({ ...production, COOKIE_SECURE: 'false' }),
      ).toThrow(/COOKIE_SECURE/);
    });

    it('rejects a wildcard CORS origin', () => {
      expect(() => validateEnv({ ...production, CORS_ORIGINS: '*' })).toThrow(
        /CORS_ORIGINS/,
      );
    });
  });

  it('rejects SameSite=None without secure cookies', () => {
    expect(() => validateEnv({ ...base, COOKIE_SAMESITE: 'none' })).toThrow(
      /SameSite=None/,
    );
  });
});
