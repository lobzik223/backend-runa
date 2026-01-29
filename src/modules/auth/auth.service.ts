import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import type { JwtAccessPayload, JwtRefreshPayload } from './types/jwt-payload';

type Tokens = {
  accessToken: string;
  refreshToken: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sms: SmsService,
  ) {}

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private normalizeReferralCode(code?: string): string | null {
    const v = code?.trim().toUpperCase();
    if (!v) return null;
    return v;
  }

  private async ensureDeviceSeen(meta?: { deviceId?: string; platform?: string; ip?: string; userAgent?: string; userId?: number }) {
    const deviceId = meta?.deviceId?.trim();
    if (!deviceId) return;

    const now = new Date();
    await this.prisma.device.upsert({
      where: { deviceId },
      create: {
        deviceId,
        platform: meta?.platform,
        userId: meta?.userId,
        ip: meta?.ip,
        userAgent: meta?.userAgent,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        platform: meta?.platform,
        userId: meta?.userId ?? undefined,
        ip: meta?.ip,
        userAgent: meta?.userAgent,
        lastSeenAt: now,
      },
    });
  }

  private async ensureUserReferralCode(userId: number): Promise<string> {
    const existing = await this.prisma.referralCode.findUnique({ where: { userId } });
    if (existing) return existing.code;

    // keep trying until unique (rare collisions)
    for (let i = 0; i < 5; i++) {
      const code = this.generateReferralCode();
      try {
        const created = await this.prisma.referralCode.create({
          data: { userId, code },
        });
        return created.code;
      } catch {
        // try again
      }
    }
    throw new Error('Не удалось сгенерировать реферальный код');
  }

  private normalizePhone(phoneE164: string): string {
    const v = phoneE164.trim();
    if (!/^\+[1-9]\d{7,14}$/.test(v)) throw new BadRequestException('Некорректный номер телефона');
    return v;
  }

  private generateOtpCode(): string {
    // 6 digits
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  private async hashOtp(code: string): Promise<string> {
    return argon2.hash(code, {
      type: argon2.argon2id,
      memoryCost: 8192,
      timeCost: 2,
      parallelism: 1,
    });
  }

  private async verifyOtpHash(hash: string, code: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, code);
    } catch {
      return false;
    }
  }

  private generateReferralCode(): string {
    // "RUNA" + 8 uppercase chars (no ambiguous chars)
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = 'RUNA';
    for (let i = 0; i < 8; i++) {
      s += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return s;
  }

  private async grantTrialDays(userId: number, days: number) {
    const now = new Date();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    
    // Use trialUntil if not set, or extend if already active
    const base = user?.trialUntil && user.trialUntil.getTime() > now.getTime() 
      ? user.trialUntil 
      : now;
    const newEnd = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: userId },
      data: { trialUntil: newEnd },
    });
  }

  private async applyReferralIfValid(params: {
    newUserId: number;
    referralCode?: string | null;
    deviceId?: string;
    ip?: string;
  }): Promise<void> {
    const referralCode = this.normalizeReferralCode(params.referralCode ?? undefined);

    // Default: 3 days for new user (even if no/invalid code)
    if (!referralCode) {
      await this.grantTrialDays(params.newUserId, 3);
      return;
    }

    const code = await this.prisma.referralCode.findUnique({
      where: { code: referralCode },
      select: { id: true, userId: true },
    });

    if (!code) {
      await this.grantTrialDays(params.newUserId, 3);
      return;
    }

    // prevent self-referral
    if (code.userId === params.newUserId) {
      await this.grantTrialDays(params.newUserId, 3);
      return;
    }

    // invitee can redeem only once (enforced by DB unique on inviteeUserId)
    // basic abuse heuristics:
    // - same device already linked to inviter user
    // - too many redemptions from same IP in last 24h
    if (params.deviceId) {
      const inviterDevice = await this.prisma.device.findFirst({
        where: { deviceId: params.deviceId, userId: code.userId },
        select: { id: true },
      });
      if (inviterDevice) {
        await this.grantTrialDays(params.newUserId, 3);
        return;
      }
    }

    if (params.ip) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const ipCount = await this.prisma.referralRedemption.count({
        where: { ip: params.ip, createdAt: { gte: since } },
      });
      if (ipCount >= 3) {
        await this.grantTrialDays(params.newUserId, 3);
        return;
      }
    }

    try {
      await this.prisma.referralRedemption.create({
        data: {
          codeId: code.id,
          inviterUserId: code.userId,
          inviteeUserId: params.newUserId,
          deviceId: params.deviceId,
          ip: params.ip,
        },
      });
    } catch {
      // If redemption fails (already redeemed), fallback to default 3 days
      await this.grantTrialDays(params.newUserId, 3);
      return;
    }

    // success: both get 7 days
    await this.grantTrialDays(params.newUserId, 7);
    await this.grantTrialDays(code.userId, 7);
  }

  async requestOtp(input: { phoneE164: string; deviceId?: string; ip?: string; userAgent?: string }) {
    const phoneE164 = this.normalizePhone(input.phoneE164);

    // basic rate limit at DB-level: allow at most 3 unconsumed in last 10 minutes
    const since = new Date(Date.now() - 10 * 60 * 1000);
    const recent = await this.prisma.phoneOtp.count({
      where: { phoneE164, createdAt: { gte: since }, consumedAt: null },
    });
    if (recent >= 3) throw new BadRequestException('Слишком много запросов. Попробуйте позже.');

    const code = this.generateOtpCode();
    const codeHash = await this.hashOtp(code);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    await this.prisma.phoneOtp.create({
      data: {
        phoneE164,
        codeHash,
        expiresAt,
        deviceId: input.deviceId,
        ip: input.ip,
      },
    });

    await this.ensureDeviceSeen({ deviceId: input.deviceId, ip: input.ip, userAgent: input.userAgent });
    await this.sms.sendOtp({ phoneE164, code });

    return { message: 'ok' };
  }

  async verifyOtp(input: { phoneE164: string; code: string; name?: string; referralCode?: string; deviceId?: string; ip?: string; userAgent?: string }) {
    const phoneE164 = this.normalizePhone(input.phoneE164);
    const code = input.code.trim();

    const otp = await this.prisma.phoneOtp.findFirst({
      where: { phoneE164, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new UnauthorizedException('Неверный код');
    if (otp.attempts >= 5) throw new UnauthorizedException('Слишком много попыток. Запросите новый код.');

    const ok = await this.verifyOtpHash(otp.codeHash, code);
    if (!ok) {
      await this.prisma.phoneOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Неверный код');
    }

    // consume OTP
    await this.prisma.phoneOtp.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });

    // If user exists: login. Referral code is ignored for existing accounts.
    let user = await this.prisma.user.findUnique({
      where: { phoneE164 },
      select: { id: true, email: true, name: true, createdAt: true },
    });

    if (!user) {
      const displayName = (input.name?.trim() || `User ${phoneE164.slice(-4)}`).slice(0, 80);
      user = await this.prisma.user.create({
        data: {
          phoneE164,
          name: displayName,
        },
        select: { id: true, email: true, name: true, createdAt: true },
      });

      await this.ensureUserReferralCode(user.id);
      await this.applyReferralIfValid({ newUserId: user.id, referralCode: input.referralCode, deviceId: input.deviceId, ip: input.ip });
    }

    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000);
    await this.prisma.refreshSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        expiresAt,
        ip: input.ip,
        userAgent: input.userAgent,
      },
    });

    await this.ensureDeviceSeen({ deviceId: input.deviceId, userId: user.id, ip: input.ip, userAgent: input.userAgent });

    const tokens = await this.signTokens(user, sessionId);
    return {
      message: 'ok',
      user,
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  private async signTokens(user: { id: number; email?: string | null }, sessionId: string): Promise<Tokens> {
    const accessPayload: JwtAccessPayload = {
      sub: user.id,
      email: user.email,
      typ: 'access',
    };
    const refreshPayload: JwtRefreshPayload = {
      sub: user.id,
      jti: sessionId,
      typ: 'refresh',
    };

    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: env.JWT_ACCESS_SECRET,
      expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    });

    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: env.JWT_REFRESH_SECRET,
      expiresIn: env.JWT_REFRESH_TTL_SECONDS,
    });

    return { accessToken, refreshToken };
  }

  async register(input: { name: string; email: string; password: string; referralCode?: string; deviceId?: string; ip?: string; userAgent?: string }) {
    const email = this.normalizeEmail(input.email);

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email уже зарегистрирован');

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    const user = await this.prisma.user.create({
      data: {
        email,
        name: input.name.trim(),
        passwordHash,
      },
      select: { id: true, email: true, name: true, createdAt: true },
    });

    // Create a refresh session immediately (optional, but nice for mobile UX)
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000);

    await this.prisma.refreshSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        expiresAt,
        ip: input.ip,
        userAgent: input.userAgent,
      },
    });

    await this.ensureDeviceSeen({ deviceId: input.deviceId, userId: user.id, ip: input.ip, userAgent: input.userAgent });
    await this.ensureUserReferralCode(user.id);
    await this.applyReferralIfValid({ newUserId: user.id, referralCode: input.referralCode, deviceId: input.deviceId, ip: input.ip });

    const tokens = await this.signTokens(user, sessionId);

    return {
      message: 'ok',
      user,
      token: tokens.accessToken, // keep compatibility with current mobile client
      refreshToken: tokens.refreshToken,
    };
  }

  async login(input: { email: string; password: string; ip?: string; userAgent?: string }) {
    const email = this.normalizeEmail(input.email);
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, passwordHash: true, createdAt: true },
    });

    if (!user) throw new UnauthorizedException('Неверный email или пароль');
    if (!user.passwordHash) throw new UnauthorizedException('Неверный email или пароль');

    const ok = await argon2.verify(user.passwordHash, input.password);
    if (!ok) throw new UnauthorizedException('Неверный email или пароль');

    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000);
    await this.prisma.refreshSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        expiresAt,
        ip: input.ip,
        userAgent: input.userAgent,
      },
    });

    const tokens = await this.signTokens(user, sessionId);

    const { passwordHash: _passwordHash, ...safeUser } = user;

    return {
      message: 'ok',
      user: safeUser,
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async me(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        trialUntil: true,
        premiumUntil: true,
        subscription: {
          select: { status: true, store: true, currentPeriodEnd: true },
        },
      },
    });
    if (!user) throw new UnauthorizedException('Пользователь не найден');

    const referralCode = await this.ensureUserReferralCode(userId);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        trialUntil: user.trialUntil,
        premiumUntil: user.premiumUntil,
        subscription:
          user.subscription == null
            ? null
            : {
                status: user.subscription.status,
                store: user.subscription.store,
                currentPeriodEnd: user.subscription.currentPeriodEnd,
              },
      },
      referralCode,
    };
  }

  /**
   * Refresh rotation with reuse detection:
   * - if a refresh session is already revoked => treat as reuse and revoke all user sessions
   */
  async refresh(userId: number, sessionId: string, meta?: { ip?: string; userAgent?: string }) {
    const session = await this.prisma.refreshSession.findUnique({
      where: { id: sessionId },
      include: { user: { select: { id: true, email: true, name: true, createdAt: true } } },
    });

    if (!session || session.userId !== userId) throw new UnauthorizedException('Недействительный refresh token');
    if (session.expiresAt.getTime() < Date.now()) throw new UnauthorizedException('Refresh token истёк');

    if (session.revokedAt) {
      // reuse detected: revoke all
      await this.prisma.refreshSession.updateMany({
        where: { userId },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Подозрительная активность. Выполните вход заново.');
    }

    const newSessionId = randomUUID();
    const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000);

    // Сначала создаём новую сессию, потом обновляем старую (чтобы внешний ключ работал)
    await this.prisma.$transaction([
      this.prisma.refreshSession.create({
        data: {
          id: newSessionId,
          userId,
          expiresAt,
          ip: meta?.ip,
          userAgent: meta?.userAgent,
        },
      }),
      this.prisma.refreshSession.update({
        where: { id: sessionId },
        data: { revokedAt: new Date(), replacedById: newSessionId },
      }),
    ]);

    const tokens = await this.signTokens(session.user, newSessionId);

    return {
      message: 'ok',
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async logout(userId: number, sessionId: string) {
    try {
      await this.prisma.refreshSession.update({
        where: { id: sessionId },
        data: { revokedAt: new Date() },
      });
    } catch {
      // ignore not-found
    }
    return { message: 'ok' };
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, nameUpdatedAt: true },
    });

    if (!user) throw new UnauthorizedException('Пользователь не найден');

    if (dto.name) {
      const now = new Date();
      const lastUpdate = user.nameUpdatedAt;
      const diffMs = now.getTime() - lastUpdate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      if (diffDays < 14) {
        const remainingDays = Math.ceil(14 - diffDays);
        throw new BadRequestException(
          `Сменить имя можно раз в 14 дней. Попробуйте через ${remainingDays} дн.`,
        );
      }

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          name: dto.name.trim(),
          nameUpdatedAt: now,
        },
      });
    }

    return this.me(userId);
  }
}

