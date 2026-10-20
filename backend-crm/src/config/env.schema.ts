import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const commaSeparatedOrigins = z
  .string()
  .trim()
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  )
  .pipe(z.array(z.string().min(1)));

/** A PEM key stored base64-encoded so it fits on one .env line. */
const base64Pem = (label: 'PRIVATE KEY' | 'PUBLIC KEY') =>
  z
    .string()
    .trim()
    .min(1)
    .transform((value) => Buffer.from(value, 'base64').toString('utf8'))
    .refine((pem) => pem.includes(`-----BEGIN ${label}-----`), {
      message: `must be a base64-encoded PEM (${label})`,
    });

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    APP_URL: z.url(),
    CORS_ORIGINS: commaSeparatedOrigins,

    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection URL'),
    MONGODB_URI: z
      .string()
      .regex(/^mongodb(\+srv)?:\/\//, 'must be a mongodb:// connection URI'),
    REDIS_URL: z
      .string()
      .regex(/^rediss?:\/\//, 'must be a redis:// URL')
      .optional(),

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    SWAGGER_ENABLED: booleanString.optional(),

    COOKIE_DOMAIN: z.string().trim().min(1).optional(),
    COOKIE_SECURE: booleanString.default(true),
    COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('strict'),

    // Express "trust proxy": false, true, or the number of proxy hops.
    TRUST_PROXY: z
      .union([booleanString, z.coerce.number().int().min(0).max(10)])
      .default(false),

    // ── Tokens ──
    JWT_PRIVATE_KEY: base64Pem('PRIVATE KEY'),
    JWT_PUBLIC_KEY: base64Pem('PUBLIC KEY'),
    JWT_ISSUER: z.string().trim().min(1).default('backend-crm'),
    JWT_AUDIENCE: z.string().trim().min(1).default('backend-crm-api'),
    JWT_ACCESS_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(3600)
      .default(900),
    TOKEN_HASH_SECRET: z
      .string()
      .min(32, 'must be at least 32 characters of random data'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    SESSION_MAX_AGE_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    REFRESH_REUSE_GRACE_SECONDS: z.coerce
      .number()
      .int()
      .min(0)
      .max(60)
      .default(10),
    PASSWORD_RESET_TTL_MINUTES: z.coerce
      .number()
      .int()
      .min(5)
      .max(1440)
      .default(30),
    EMAIL_VERIFICATION_TTL_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(168)
      .default(24),

    // ── Rate limiting (per client IP) ──
    AUTH_THROTTLE_LIMIT: z.coerce.number().int().min(1).default(10),
    AUTH_THROTTLE_TTL_SECONDS: z.coerce.number().int().min(1).default(60),

    // ── Mail ──
    WEB_APP_URL: z.url().optional(),
    MAIL_FROM: z.string().trim().min(3).default('CRM <no-reply@localhost>'),
    SMTP_HOST: z.string().trim().min(1).default('localhost'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    SMTP_SECURE: booleanString.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),

    // ── Billing ──
    /** Free trial for new sign-ups, in days. 0 disables the trial. */
    BILLING_TRIAL_DAYS: z.coerce.number().int().min(0).max(90).default(7),
    /** Plan code given at sign-up when the visitor does not pick one. */
    BILLING_DEFAULT_PLAN: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_-]{1,49}$/)
      .default('team'),
    BILLING_DEFAULT_INTERVAL: z.enum(['MONTH', 'YEAR']).default('MONTH'),
    BILLING_CURRENCY: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code such as USD')
      .default('USD'),
    /**
     * disabled: plans can be chosen during the trial, but nothing can be paid.
     * simulated: payments succeed instantly (development/testing only).
     */
    BILLING_PAYMENTS_MODE: z
      .enum(['disabled', 'simulated'])
      .default('disabled'),

    // ── Channels (WhatsApp Cloud API) ──
    /** 32 random bytes, base64. Encrypts line credentials (AES-256-GCM). */
    CHANNEL_SECRETS_KEY: z
      .string()
      .trim()
      .refine((value) => Buffer.from(value, 'base64').length === 32, {
        message: 'must be 32 random bytes encoded as base64',
      }),
    /** Public base URL of this API, shown as the webhook URL to paste in Meta. */
    PUBLIC_API_URL: z.url().optional(),
    /** live: talk to Meta. simulated: outgoing messages succeed without calling Meta (dev only). */
    WHATSAPP_MODE: z.enum(['live', 'simulated']).default('live'),
    WHATSAPP_GRAPH_BASE_URL: z.url().default('https://graph.facebook.com'),
    WHATSAPP_GRAPH_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/)
      .default('v23.0'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    if (env.BILLING_PAYMENTS_MODE === 'simulated') {
      ctx.addIssue({
        code: 'custom',
        path: ['BILLING_PAYMENTS_MODE'],
        message: 'simulated payments are not allowed in production',
      });
    }
    if (env.WHATSAPP_MODE === 'simulated') {
      ctx.addIssue({
        code: 'custom',
        path: ['WHATSAPP_MODE'],
        message: 'simulated WhatsApp is not allowed in production',
      });
    }

    if (!env.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'must be true in production',
      });
    }
    if (env.CORS_ORIGINS.some((origin) => origin === '*')) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'wildcard origin is not allowed in production',
      });
    }
  })
  .superRefine((env, ctx) => {
    if (env.COOKIE_SAMESITE === 'none' && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SAMESITE'],
        message: 'SameSite=None requires COOKIE_SECURE=true',
      });
    }
  })
  .transform((env) => ({
    ...env,
    // Swagger is opt-in for production and on by default elsewhere.
    SWAGGER_ENABLED: env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production',
    WEB_APP_URL: env.WEB_APP_URL ?? env.APP_URL,
    PUBLIC_API_URL: env.PUBLIC_API_URL ?? env.APP_URL,
  }));

export type Env = z.infer<typeof envSchema>;

/**
 * Used by ConfigModule.forRoot({ validate }). Throws with a list of invalid
 * variable names (never their values, which may be secrets).
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}
