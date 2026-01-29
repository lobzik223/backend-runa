import 'dotenv/config';
import { z } from 'zod';

const envSchema = z
  .object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().default('/api'),

  DATABASE_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),

  CORS_ORIGIN: z.string().default('*'),
  THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(30),

  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  // Grok (xAI) для RUNA AI чата — пустая строка в Docker = «не задано»
  GROK_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  XAI_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  GROK_MODEL: z.string().default('grok-4-1-fast-reasoning'),
  // OpenAI (опционально)
  OPENAI_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  OPENAI_MODEL: z.string().default('gpt-5-nano'),

  // Optional application key to protect API from random access.
  APP_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(8).optional()),

  // Tinkoff InvestAPI
  TINKOFF_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  TINKOFF_DEMO_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),

  })
  .superRefine((v, ctx) => {
    // В проде всегда требуем APP_KEY, чтобы API не был открыт “наружу”.
    if (v.NODE_ENV === 'production' && !v.APP_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_KEY'],
        message: 'APP_KEY is required in production',
      });
    }
  });

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;

