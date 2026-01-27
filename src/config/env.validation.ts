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

  // Timeweb Cloud AI (for AI chat)
  TIMEWEB_AI_ACCESS_ID: z.string().min(1).optional(),
  TIMEWEB_AI_API_URL: z.string().url().optional(),
  // Legacy OpenAI support (optional)
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().default('gpt-5-nano'),

  // Optional application key to protect API from random access.
  // If set, every request (except /api/health) must include header: X-Runa-App-Key
  APP_KEY: z.string().min(8).optional(),

  // Tinkoff InvestAPI
  TINKOFF_TOKEN: z.string().min(1).optional(),
  TINKOFF_DEMO_TOKEN: z.string().min(1).optional(),

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

