import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
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

  // OpenAI (optional, for AI chat)
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().default('gpt-5-nano'),

  // Optional application key to protect API from random access.
  // If set, every request (except /api/health) must include header: X-Runa-App-Key
  APP_KEY: z.string().min(8).optional(),

  // Tinkoff Invest Demo Mode
  // Общий токен для демо-режима (песочница Tinkoff Invest)
  // Если установлен, все пользователи могут использовать демо-инвестиции без своего токена
  TINKOFF_DEMO_TOKEN: z.string().min(1).optional(),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;

