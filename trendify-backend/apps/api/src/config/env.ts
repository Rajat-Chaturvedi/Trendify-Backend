import { z } from 'zod';

const envSchema = z.object({
  // Required — database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (PostgreSQL connection string)'),

  // Required — cache / rate-limiting
  REDIS_URL: z.string().min(1, 'REDIS_URL is required (Redis connection string)'),

  // Required — JWT RS256 key pair (PEM-encoded)
  JWT_PRIVATE_KEY: z.string().min(1, 'JWT_PRIVATE_KEY is required (RS256 private key in PEM format)'),
  JWT_PUBLIC_KEY: z.string().min(1, 'JWT_PUBLIC_KEY is required (RS256 public key in PEM format)'),

  // Required — CMS webhook validation
  STRAPI_WEBHOOK_SECRET: z.string().min(1, 'STRAPI_WEBHOOK_SECRET is required (shared HMAC secret for webhook validation)'),

  // Required — CORS
  ALLOWED_ORIGINS: z.string().min(1, 'ALLOWED_ORIGINS is required (comma-separated list of allowed CORS origins)'),

  // Required — CMS webhook target URL
  WEBHOOK_URL: z.string().url('WEBHOOK_URL must be a valid URL (the URL the CMS posts webhooks to)'),

  // Optional — server
  PORT: z
    .string()
    .optional()
    .default('3000')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0 && val < 65536, {
      message: 'PORT must be a valid port number (1–65535)',
    }),

  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .optional()
    .default('development'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const missing = result.error.issues.map((issue) => {
      const field = issue.path.join('.');
      return `  - ${field}: ${issue.message}`;
    });

    throw new Error(
      `[env] Server startup aborted — missing or invalid environment variables:\n${missing.join('\n')}\n\n` +
        `Copy .env.example to .env and fill in the required values.`,
    );
  }

  return result.data;
}

export const env = loadEnv();
