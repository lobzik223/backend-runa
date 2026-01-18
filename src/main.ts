import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { env } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
      credentials: true,
    },
  });

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Lightweight app-level protection: allow only our mobile app if APP_KEY is configured.
  // This is NOT a replacement for HTTPS/JWT, but blocks random scanners.
  if (env.APP_KEY) {
    app.use((req: any, res: any, next: any) => {
      const path = req?.originalUrl || req?.url || '';
      // keep health open for infrastructure checks
      if (path.startsWith(`${env.API_PREFIX}/health`)) return next();
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

