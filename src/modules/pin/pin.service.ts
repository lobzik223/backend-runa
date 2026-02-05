import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { ResetPinDto } from './dto/reset-pin.dto';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 10;

@Injectable()
export class PinService {
  constructor(private readonly prisma: PrismaService) {}

  private async hashPin(pin: string): Promise<string> {
    return argon2.hash(pin, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  private async verifyPinHash(hash: string, pin: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, pin);
    } catch {
      return false;
    }
  }

  private async verifyGoogleIdToken(idToken: string): Promise<string | null> {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    ).catch(() => null);
    if (!res?.ok) return null;
    const payload = (await res.json()) as { email?: string };
    return payload.email ?? null;
  }

  async status(userId: number) {
    const row = await this.prisma.pinSecurity.findUnique({
      where: { userId },
      select: {
        userId: true,
        pinLength: true,
        biometricEnabled: true,
        failedAttempts: true,
        lockedUntil: true,
        lastVerifiedAt: true,
      },
    });

    return {
      pinSet: !!row,
      pinLength: row?.pinLength ?? 4,
      biometricEnabled: row?.biometricEnabled ?? false,
      failedAttempts: row?.failedAttempts ?? 0,
      lockedUntil: row?.lockedUntil ?? null,
      lastVerifiedAt: row?.lastVerifiedAt ?? null,
    };
  }

  async setPin(userId: number, dto: { pin: string; pinLength?: 4 | 6; biometricEnabled?: boolean }) {
    const pin = dto.pin.trim();
    if (!/^\d{4}$|^\d{6}$/.test(pin)) throw new BadRequestException('PIN должен быть 4 или 6 цифр');
    const pinLength = (dto.pinLength ?? (pin.length as 4 | 6));
    if (pinLength !== 4 && pinLength !== 6) throw new BadRequestException('Некорректная длина PIN');
    if (pin.length !== pinLength) throw new BadRequestException('PIN не совпадает с выбранной длиной');

    const existing = await this.prisma.pinSecurity.findUnique({ where: { userId } });
    if (existing) throw new ConflictException('PIN уже установлен. Используйте reset_pin.');

    const pinHash = await this.hashPin(pin);
    await this.prisma.pinSecurity.create({
      data: {
        userId,
        pinHash,
        pinLength,
        biometricEnabled: dto.biometricEnabled ?? false,
        failedAttempts: 0,
        lockedUntil: null,
        lastVerifiedAt: null,
      },
    });

    return { message: 'ok' };
  }

  async verifyPin(userId: number, pin: string) {
    const row = await this.prisma.pinSecurity.findUnique({
      where: { userId },
      select: { pinHash: true, failedAttempts: true, lockedUntil: true, pinLength: true, biometricEnabled: true },
    });
    if (!row) throw new BadRequestException('PIN не установлен');

    const now = new Date();
    if (row.lockedUntil && row.lockedUntil.getTime() > now.getTime()) {
      const secondsLeft = Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 1000);
      throw new ForbiddenException(`PIN заблокирован. Попробуйте через ${secondsLeft} сек.`);
    }

    if (pin.length !== row.pinLength) {
      await this.bumpFailed(userId, row.failedAttempts);
      throw new UnauthorizedException('Неверный PIN');
    }

    const ok = await this.verifyPinHash(row.pinHash, pin);
    if (!ok) {
      await this.bumpFailed(userId, row.failedAttempts);
      throw new UnauthorizedException('Неверный PIN');
    }

    await this.prisma.pinSecurity.update({
      where: { userId },
      data: {
        failedAttempts: 0,
        lockedUntil: null,
        lastVerifiedAt: now,
      },
    });

    return { message: 'ok', biometricEnabled: row.biometricEnabled, pinLength: row.pinLength };
  }

  private async bumpFailed(userId: number, currentAttempts: number) {
    const next = currentAttempts + 1;
    const lock = next >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null;
    await this.prisma.pinSecurity.update({
      where: { userId },
      data: {
        failedAttempts: next,
        lockedUntil: lock,
      },
    });
  }

  /**
   * reset_pin requires re-auth:
   * - Email users: provide current password
   * - Phone users: provide OTP code (must be requested via /auth/otp/request)
   */
  async resetPin(userId: number, dto: ResetPinDto) {
    const newPin = dto.newPin.trim();
    if (!/^\d{4}$|^\d{6}$/.test(newPin)) throw new BadRequestException('PIN должен быть 4 или 6 цифр');
    const pinLength = (dto.pinLength ?? (newPin.length as 4 | 6));
    if (newPin.length !== pinLength) throw new BadRequestException('PIN не совпадает с выбранной длиной');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, phoneE164: true, passwordHash: true },
    });
    if (!user) throw new UnauthorizedException('Пользователь не найден');

    // Re-auth
    if (user.passwordHash) {
      if (!dto.password) throw new BadRequestException('Требуется пароль для сброса PIN');
      const ok = await argon2.verify(user.passwordHash, dto.password);
      if (!ok) throw new UnauthorizedException('Неверный пароль');
    } else if (user.phoneE164) {
      if (!dto.otpCode) throw new BadRequestException('Требуется OTP код для сброса PIN');
      const otp = await this.prisma.phoneOtp.findFirst({
        where: { phoneE164: user.phoneE164, consumedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      });
      if (!otp) throw new UnauthorizedException('Неверный OTP код');
      if (otp.attempts >= 5) throw new UnauthorizedException('Слишком много попыток OTP. Запросите новый код.');

      const ok = await argon2.verify(otp.codeHash, dto.otpCode.trim());
      if (!ok) {
        await this.prisma.phoneOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
        throw new UnauthorizedException('Неверный OTP код');
      }

      await this.prisma.phoneOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    } else if (user.email && dto.googleIdToken?.trim()) {
      const tokenEmail = await this.verifyGoogleIdToken(dto.googleIdToken.trim());
      const normalized = tokenEmail?.trim().toLowerCase();
      if (!normalized || normalized !== user.email.trim().toLowerCase()) {
        throw new UnauthorizedException('Неверный Google аккаунт. Войдите в тот же аккаунт.');
      }
    } else {
      throw new BadRequestException('Подтвердите личность через Google (повторный вход) или используйте другой способ восстановления.');
    }

    const pinHash = await this.hashPin(newPin);
    await this.prisma.pinSecurity.upsert({
      where: { userId },
      create: {
        userId,
        pinHash,
        pinLength,
        biometricEnabled: dto.biometricEnabled ?? false,
        failedAttempts: 0,
        lockedUntil: null,
        lastVerifiedAt: null,
      },
      update: {
        pinHash,
        pinLength,
        biometricEnabled: dto.biometricEnabled ?? false,
        failedAttempts: 0,
        lockedUntil: null,
        lastVerifiedAt: null,
      },
    });

    return { message: 'ok' };
  }

  async getReauthMethod(userId: number): Promise<{ method: 'password' | 'google' | 'otp' }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true, phoneE164: true },
    });
    if (!user) throw new UnauthorizedException('Пользователь не найден');
    if (user.passwordHash) return { method: 'password' };
    if (user.phoneE164) return { method: 'otp' };
    return { method: 'google' };
  }
}

