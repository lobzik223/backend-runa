import {
  Injectable,
  UnauthorizedException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { env } from '../../config/env.validation';
import type { AdminJwtPayload } from './admin-auth.types';

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Вход в админ-панель. Только существующие админы (созданные через CLI).
   */
  async login(email: string, password: string): Promise<{
    accessToken: string;
    admin: { id: number; email: string; name: string | null; role: string };
  }> {
    try {
      const normalizedEmail = this.normalizeEmail(email);
      const passwordClean = typeof password === 'string' ? password.trim() : '';
      if (!passwordClean) {
        this.logger.warn(`[Admin] Failed login attempt: email=${normalizedEmail} (empty password)`);
        throw new UnauthorizedException('Неверный email или пароль');
      }
      const admin = await this.prisma.admin.findUnique({
        where: { email: normalizedEmail },
      });

      if (!admin) {
        this.logger.warn(`[Admin] Failed login attempt: email=${normalizedEmail} (not found)`);
        throw new UnauthorizedException('Неверный email или пароль');
      }

      const valid = await argon2.verify(admin.passwordHash, passwordClean);
      if (!valid) {
        this.logger.warn(`[Admin] Failed login attempt: email=${normalizedEmail} (wrong password)`);
        throw new UnauthorizedException('Неверный email или пароль');
      }

      const role = (admin as { role?: string }).role ?? 'SUPER_ADMIN';
      const payload: AdminJwtPayload = {
        sub: admin.id,
        email: admin.email,
        role: role as 'SUPER_ADMIN',
        typ: 'admin',
      };

      const secret = env.JWT_ADMIN_SECRET;
      if (!secret || secret.length < 32) {
        this.logger.error('[Admin] JWT_ADMIN_SECRET не задан или короче 32 символов');
        throw new InternalServerErrorException('Ошибка конфигурации входа. Обратитесь к администратору.');
      }

      const accessToken = await this.jwt.signAsync(payload, {
        secret,
        expiresIn: env.JWT_ADMIN_TTL_SECONDS,
      });

      this.logger.log(`[Admin] Login success: id=${admin.id} email=${admin.email} role=${role}`);

      return {
        accessToken,
        admin: {
          id: admin.id,
          email: admin.email,
          name: (admin as { name?: string | null }).name ?? null,
          role,
        },
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error(`[Admin] Login error: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? err.stack : undefined);
      throw new InternalServerErrorException('Ошибка при входе. Попробуйте позже или обратитесь к администратору.');
    }
  }

  /**
   * Проверка токена и возврат данных админа (для GET /admin/me).
   */
  async me(adminId: number): Promise<{ id: number; email: string; name: string | null; role: string }> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
    });
    if (!admin) {
      throw new UnauthorizedException('Админ не найден');
    }
    return {
      id: admin.id,
      email: admin.email,
      name: admin.name ?? null,
      role: admin.role,
    };
  }

  /**
   * Проверка пароля текущего админа (для подтверждения критичных действий в панели).
   */
  async verifyPassword(adminId: number, password: string): Promise<{ valid: true }> {
    const p = typeof password === 'string' ? password.trim() : '';
    if (!p) throw new UnauthorizedException('Введите пароль');
    const admin = await this.prisma.admin.findUnique({ where: { id: adminId } });
    if (!admin) throw new UnauthorizedException('Админ не найден');
    const valid = await argon2.verify(admin.passwordHash, p);
    if (!valid) throw new UnauthorizedException('Неверный пароль');
    return { valid: true };
  }
}
