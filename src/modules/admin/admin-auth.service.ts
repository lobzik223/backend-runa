import {
  Injectable,
  UnauthorizedException,
  Logger,
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
    const normalizedEmail = this.normalizeEmail(email);
    const admin = await this.prisma.admin.findUnique({
      where: { email: normalizedEmail },
    });

    if (!admin) {
      this.logger.warn(`[Admin] Failed login attempt: email=${normalizedEmail} (not found)`);
      throw new UnauthorizedException('Неверный email или пароль');
    }

    const valid = await argon2.verify(admin.passwordHash, password);
    if (!valid) {
      this.logger.warn(`[Admin] Failed login attempt: email=${normalizedEmail} (wrong password)`);
      throw new UnauthorizedException('Неверный email или пароль');
    }

    const payload: AdminJwtPayload = {
      sub: admin.id,
      email: admin.email,
      role: admin.role,
      typ: 'admin',
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: env.JWT_ADMIN_SECRET,
      expiresIn: env.JWT_ADMIN_TTL_SECONDS,
    });

    this.logger.log(`[Admin] Login success: id=${admin.id} email=${admin.email} role=${admin.role}`);

    return {
      accessToken,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name ?? null,
        role: admin.role,
      },
    };
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
}
