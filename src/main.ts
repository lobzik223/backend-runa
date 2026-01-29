import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import helmet from 'helmet';
import { join } from 'path';
import express from 'express';
import { AppModule } from './app.module';
import { env } from './config/env.validation';

async function bootstrap() {
  const corsOrigins = env.CORS_ORIGIN === '*'
    ? true
    : [...env.CORS_ORIGIN.split(',').map((o) => o.trim()), 'https://runafinance.online'].filter(Boolean);
  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Runa-App-Key', 'X-Runa-Site-Key'],
    },
  });

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Иконки акций (SVG из tinkofficon) — раздаём без авторизации
  app.use('/assets/icons', express.static(join(process.cwd(), 'tinkofficon')));

  // Lightweight app-level protection: allow only our mobile app if APP_KEY is configured.
  // This is NOT a replacement for HTTPS/JWT, but blocks random scanners.
  if (env.APP_KEY) {
    app.use((req: any, res: any, next: any) => {
      const reqPath = req?.originalUrl || req?.url || '';
      const prefix = env.API_PREFIX.replace(/^\//, '');
      const healthPath = `/${prefix}/health`;
      const paymentsPath = `/${prefix}/payments`;
      // Иконки акций (SVG) — открыты для загрузки в приложении
      if (reqPath.startsWith('/assets/icons')) return next();
      // GET /api/health — открыт для проверки доступности
      if (reqPath === healthPath && req.method === 'GET') return next();
      // POST /api/health/maintenance — только с APP_KEY (включить/выключить режим «Ведутся работы»)
      if (reqPath === `${healthPath}/maintenance` && req.method === 'POST') {
        const key = req.headers['x-runa-app-key'];
        if (key === env.APP_KEY) return next();
        return res.status(401).json({ statusCode: 401, message: 'Unauthorized' });
      }
      if (reqPath.startsWith(healthPath)) return next();
      // Платежи с сайта — проверяются по x-runa-site-key в контроллере (CORS разрешает runafinance.online)
      if (reqPath.startsWith(paymentsPath)) return next();
      const key = req.headers['x-runa-app-key'];
      if (key !== env.APP_KEY) {
        return res.status(401).json({ statusCode: 401, message: 'Unauthorized' });
      }
      return next();
    });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      skipMissingProperties: true, // Пропускать валидацию отсутствующих опциональных полей
    }),
  );

  app.setGlobalPrefix(env.API_PREFIX.replace(/^\//, ''));

  await app.listen(env.PORT, '0.0.0.0');
  const logger = new Logger('bootstrap');
  logger.log(`listening on :${env.PORT}${env.API_PREFIX}`);
}

void bootstrap();

