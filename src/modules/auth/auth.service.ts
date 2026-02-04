import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.validation';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { EntitlementsService } from '../subscriptions/entitlements.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import type { JwtAccessPayload, JwtRefreshPayload } from './types/jwt-payload';

type Tokens = {
  accessToken: string;
  refreshToken: string;
};

const EMAIL_CODE_TTL_MS = 15 * 60 * 1000; // 15 минут
const EMAIL_RESEND_COOLDOWN_MS = 3 * 60 * 1000; // 3 минуты до повторной отправки

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sms: SmsService,
    private readonly emailService: EmailService,
    private readonly entitlementsService: EntitlementsService,
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

  /**
   * Applies referral bonus if code is valid.
   * Один промокод = одно использование. Выдаём 7 дней premiumUntil (премиум), не trial.
   */
  private async applyReferralIfValid(params: {
    newUserId: number;
    referralCode?: string | null;
    deviceId?: string;
    ip?: string;
  }): Promise<{ applied: boolean; referralError?: 'already_used' | 'invalid' }> {
    const referralCode = this.normalizeReferralCode(params.referralCode ?? undefined);

    // Default: 3 days trial for new user (even if no/invalid code)
    if (!referralCode) {
      this.logger.warn(`[Referral] newUserId=${params.newUserId}: код пустой или не передан`);
      await this.grantTrialDays(params.newUserId, 3);
      return { applied: false, referralError: 'invalid' };
    }

    const code = await this.prisma.referralCode.findUnique({
      where: { code: referralCode },
      select: { id: true, userId: true },
    });

    if (!code) {
      this.logger.warn(`[Referral] newUserId=${params.newUserId}: промокод не найден в БД code="${referralCode}"`);
      await this.grantTrialDays(params.newUserId, 3);
      return { applied: false, referralError: 'invalid' };
    }

    // Один промокод = одно использование: если этот код уже кем-то использован — отказ
    const codeAlreadyUsed = await this.prisma.referralRedemption.findFirst({
      where: { codeId: code.id },
    });
    if (codeAlreadyUsed) {
      this.logger.warn(`[Referral] newUserId=${params.newUserId}: промокод уже использован codeId=${code.id} inviterUserId=${code.userId}`);
      await this.grantTrialDays(params.newUserId, 3);
      return { applied: false, referralError: 'already_used' };
    }

    // prevent self-referral
    if (code.userId === params.newUserId) {
      this.logger.warn(`[Referral] newUserId=${params.newUserId}: самореферал (userId=inviter)`);
      await this.grantTrialDays(params.newUserId, 3);
      return { applied: false, referralError: 'invalid' };
    }

    // Each user can be invitee only once ever (DB unique on inviteeUserId)
    const existingRedemption = await this.prisma.referralRedemption.findUnique({
      where: { inviteeUserId: params.newUserId },
    });
    if (existingRedemption) {
      this.logger.warn(`[Referral] newUserId=${params.newUserId}: этот пользователь уже использовал другой промокод`);
      await this.grantTrialDays(params.newUserId, 3);
      return { applied: false, referralError: 'invalid' };
    }

    // Abuse heuristics: тот же deviceId что и у пригласившего = подозрение на мультиаккаунт
    if (params.deviceId) {
      const inviterDevice = await this.prisma.device.findFirst({
        where: { deviceId: params.deviceId, userId: code.userId },
        select: { id: true },
      });
      if (inviterDevice) {
        this.logger.warn(`[Referral] newUserId=${params.newUserId}: тот же deviceId что у пригласившего userId=${code.userId} (регистрация с устройства А)`);
        await this.grantTrialDays(params.newUserId, 3);
        return { applied: false, referralError: 'invalid' };
      }
    }

    if (params.ip) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const ipCount = await this.prisma.referralRedemption.count({
        where: { ip: params.ip, createdAt: { gte: since } },
      });
      if (ipCount >= 3) {
        this.logger.warn(`[Referral] newUserId=${params.newUserId}: с IP ${params.ip} уже 3+ реферала за 24ч`);
        await this.grantTrialDays(params.newUserId, 3);
        return { applied: false, referralError: 'invalid' };
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
    } catch (err) {
      this.logger.error(`[Referral] newUserId=${params.newUserId}: ошибка создания ReferralRedemption`, err instanceof Error ? err.message : err);
      await this.grantTrialDays(params.newUserId, 3);
      return { applied: false, referralError: 'invalid' };
    }

    // Invitee: 7 дней премиума (premiumUntil)
    await this.entitlementsService.grantPremium(params.newUserId, 7);
    // Inviter: всегда начисляем 7 дней премиума при успешном использовании кода (если уже есть премиум — продлеваем)
    await this.entitlementsService.grantPremium(code.userId, 7);

    this.logger.log(`[Referral] OK: inviteeUserId=${params.newUserId} inviterUserId=${code.userId} code="${referralCode}" — обоим начислено 7 дней премиума`);
    return { applied: true };
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
    const referralResult = await this.applyReferralIfValid({ newUserId: user.id, referralCode: input.referralCode, deviceId: input.deviceId, ip: input.ip });

    const tokens = await this.signTokens(user, sessionId);

    // Вернуть пользователя с актуальными trialUntil/premiumUntil после начисления реферала
    const userWithEntitlements = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, name: true, createdAt: true, trialUntil: true, premiumUntil: true },
    });

    return {
      message: 'ok',
      user: userWithEntitlements ?? user,
      token: tokens.accessToken, // keep compatibility with current mobile client
      refreshToken: tokens.refreshToken,
      referralApplied: referralResult.applied,
      referralError: referralResult.referralError,
    };
  }

  /** Шаг 1 регистрации по email: отправка 6-значного кода на почту. Повторная отправка — не раньше чем через 3 мин. */
  async requestRegistrationCode(input: {
    name: string;
    email: string;
    password: string;
    referralCode?: string;
    deviceId?: string;
    ip?: string;
  }) {
    try {
      const email = this.normalizeEmail(input.email);

      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing) {
        throw new ConflictException(
          'Этот email уже зарегистрирован. Войдите под ним (пароль или кнопка «Войти через Google»).',
        );
      }

      const since = new Date(Date.now() - EMAIL_RESEND_COOLDOWN_MS);
      const recent = await this.prisma.emailVerificationCode.count({
        where: { email, purpose: 'registration', createdAt: { gte: since } },
      });
      if (recent > 0) {
        throw new BadRequestException('Повторная отправка кода возможна через 3 минуты');
      }

      const code = this.generateOtpCode();
      const codeHash = await this.hashOtp(code);
      const expiresAt = new Date(Date.now() + EMAIL_CODE_TTL_MS);

      const passwordHash = await argon2.hash(input.password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });

      const payload = {
        name: input.name.trim(),
        passwordHash,
        referralCode: input.referralCode?.trim() || null,
      };

      await this.prisma.emailVerificationCode.create({
        data: {
          email,
          codeHash,
          purpose: 'registration',
          payload: payload as object,
          expiresAt,
        },
      });

      // Отправка письма в фоне — ответ клиенту сразу, без ожидания SMTP (избегаем 504)
      this.emailService
        .sendVerificationCode({ to: email, code, purpose: 'registration' })
        .catch((err) => this.logger.error('Background email send failed', err));

      return { message: 'ok', email };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(
        `requestRegistrationCode failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new ServiceUnavailableException('Сервис временно недоступен. Попробуйте позже.');
    }
  }

  /** Шаг 2 регистрации: проверка кода и создание пользователя, выдача токенов. */
  async verifyRegistrationCode(input: {
    email: string;
    code: string;
    deviceId?: string;
    ip?: string;
    userAgent?: string;
  }) {
    const email = this.normalizeEmail(input.email);
    const code = input.code.trim();

    const record = await this.prisma.emailVerificationCode.findFirst({
      where: {
        email,
        purpose: 'registration',
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) throw new UnauthorizedException('Неверный или истёкший код');
    if (record.attempts >= 5) throw new UnauthorizedException('Слишком много попыток. Запросите новый код.');

    const ok = await this.verifyOtpHash(record.codeHash, code);
    if (!ok) {
      await this.prisma.emailVerificationCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Неверный код');
    }

    const payload = record.payload as { name: string; passwordHash: string; referralCode?: string | null };
    if (!payload?.name || !payload?.passwordHash) throw new UnauthorizedException('Данные кода повреждены');

    await this.prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new ConflictException(
        'Этот email уже зарегистрирован. Войдите под ним (пароль или кнопка «Войти через Google»).',
      );
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        name: payload.name,
        passwordHash: payload.passwordHash,
      },
      select: { id: true, email: true, name: true, createdAt: true },
    });

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
    const referralCodeFromPayload = payload.referralCode ?? undefined;
    this.logger.log(`[Referral] verifyRegistrationCode: newUserId=${user.id} email=${input.email} referralCode=${referralCodeFromPayload ? `"${referralCodeFromPayload}"` : 'null'} deviceId=${input.deviceId ?? 'null'}`);
    const referralResult = await this.applyReferralIfValid({
      newUserId: user.id,
      referralCode: referralCodeFromPayload,
      deviceId: input.deviceId,
      ip: input.ip,
    });

    const tokens = await this.signTokens(user, sessionId);

    // Вернуть пользователя с актуальными trialUntil/premiumUntil после начисления реферала
    const userWithEntitlements = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, name: true, createdAt: true, trialUntil: true, premiumUntil: true },
    });

    return {
      message: 'ok',
      user: userWithEntitlements ?? user,
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      referralApplied: referralResult.applied,
      referralError: referralResult.referralError,
    };
  }

  /** Запрос кода для сброса пароля на email. Повтор — не раньше чем через 3 мин. */
  async requestPasswordReset(input: { email: string; ip?: string }) {
    const email = this.normalizeEmail(input.email);

    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) {
      // Не раскрываем, есть ли такой email
      return { message: 'ok', email };
    }

    const since = new Date(Date.now() - EMAIL_RESEND_COOLDOWN_MS);
    const recent = await this.prisma.emailVerificationCode.count({
      where: { email, purpose: 'password_reset', createdAt: { gte: since } },
    });
    if (recent > 0) {
      throw new BadRequestException('Повторная отправка кода возможна через 3 минуты');
    }

    const code = this.generateOtpCode();
    const codeHash = await this.hashOtp(code);
    const expiresAt = new Date(Date.now() + EMAIL_CODE_TTL_MS);

    await this.prisma.emailVerificationCode.create({
      data: { email, codeHash, purpose: 'password_reset', expiresAt },
    });

    try {
      await this.emailService.sendVerificationCode({
        to: email,
        code,
        purpose: 'password_reset',
      });
    } catch (err) {
      this.logger.error(`requestPasswordReset: failed to send email to ${email}`, err);
      throw new InternalServerErrorException(
        'Не удалось отправить письмо. Проверьте настройки почты на сервере или попробуйте позже.',
      );
    }

    return { message: 'ok', email };
  }

  /** Сброс пароля по коду из письма. */
  async resetPassword(input: { email: string; code: string; newPassword: string; ip?: string }) {
    const email = this.normalizeEmail(input.email);
    const code = input.code.trim();

    const record = await this.prisma.emailVerificationCode.findFirst({
      where: {
        email,
        purpose: 'password_reset',
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) throw new UnauthorizedException('Неверный или истёкший код');
    if (record.attempts >= 5) throw new UnauthorizedException('Слишком много попыток. Запросите новый код.');

    const ok = await this.verifyOtpHash(record.codeHash, code);
    if (!ok) {
      await this.prisma.emailVerificationCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Неверный код');
    }

    await this.prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    const passwordHash = await argon2.hash(input.newPassword, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    await this.prisma.user.update({
      where: { email },
      data: { passwordHash },
    });

    return { message: 'ok' };
  }

  async login(input: { email: string; password: string; ip?: string; userAgent?: string }) {
    try {
      return await this.loginInternal(input);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(
        `login failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  private async loginInternal(input: { email: string; password: string; ip?: string; userAgent?: string }) {
    const email = this.normalizeEmail(input.email);
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
        createdAt: true,
        deletionRequestedAt: true,
        scheduledDeleteAt: true,
        restoreUntil: true,
      },
    });

    if (!user) throw new UnauthorizedException('Неверный email или пароль');
    if (!user.passwordHash) throw new UnauthorizedException('Неверный email или пароль');

    const ok = await argon2.verify(user.passwordHash, input.password);
    if (!ok) throw new UnauthorizedException('Неверный email или пароль');

    const now = new Date();
    if (user.deletionRequestedAt && user.scheduledDeleteAt && user.scheduledDeleteAt.getTime() > now.getTime()) {
      const restoreUntil = user.restoreUntil ? user.restoreUntil.getTime() : 0;
      const daysLeftRestore = Math.max(0, Math.ceil((restoreUntil - now.getTime()) / (24 * 60 * 60 * 1000)));
      const daysLeftDelete = Math.ceil((user.scheduledDeleteAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      return {
        message: 'account_scheduled_for_deletion',
        accountScheduledForDeletion: true,
        email: user.email,
        daysLeftRestore,
        daysLeftDelete,
      } as any;
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

    const tokens = await this.signTokens(user, sessionId);

    const { passwordHash: _passwordHash, ...safeUser } = user;

    return {
      message: 'ok',
      user: safeUser,
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  /**
   * Вход или «регистрация» через Google по id_token.
   * Один аккаунт на один email: если пользователь уже есть (создан по почте+пароль или ранее через Google) — всегда вход в этот же аккаунт; иначе создаётся новый.
   */
  async loginWithGoogle(input: { idToken: string; ip?: string; userAgent?: string }) {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(input.idToken)}`,
    ).catch(() => null);
    if (!res?.ok) throw new UnauthorizedException('Недействительный Google токен');

    const payload = (await res.json()) as { email?: string; name?: string; given_name?: string; family_name?: string; sub?: string };
    const email = payload.email ? this.normalizeEmail(payload.email) : null;
    if (!email) throw new UnauthorizedException('Google токен не содержит email');

    const name =
      payload.name?.trim() ||
      [payload.given_name, payload.family_name].filter(Boolean).join(' ').trim() ||
      email.split('@')[0];
    const safeName = (name ?? email).slice(0, 255);

    let user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        deletionRequestedAt: true,
        scheduledDeleteAt: true,
        restoreUntil: true,
      },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: { email, name: safeName, passwordHash: null },
        select: {
          id: true,
          email: true,
          name: true,
          createdAt: true,
          deletionRequestedAt: true,
          scheduledDeleteAt: true,
          restoreUntil: true,
        },
      });
      await this.ensureUserReferralCode(user.id);
    }

    const now = new Date();
    if (user.deletionRequestedAt && user.scheduledDeleteAt && user.scheduledDeleteAt.getTime() > now.getTime()) {
      const restoreUntil = user.restoreUntil ? user.restoreUntil.getTime() : 0;
      const daysLeftRestore = Math.max(0, Math.ceil((restoreUntil - now.getTime()) / (24 * 60 * 60 * 1000)));
      const daysLeftDelete = Math.ceil((user.scheduledDeleteAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      return {
        message: 'account_scheduled_for_deletion',
        accountScheduledForDeletion: true,
        email: user.email,
        daysLeftRestore,
        daysLeftDelete,
      } as any;
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

    const tokens = await this.signTokens(user, sessionId);

    return {
      message: 'ok',
      user,
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

  /** Запрос кода на почту для подтверждения удаления аккаунта (только для авторизованного пользователя). locale — язык письма (ru/en). */
  async requestAccountDeletion(userId: number, locale?: 'ru' | 'en') {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, deletionRequestedAt: true },
    });
    if (!user) throw new UnauthorizedException('Пользователь не найден');
    if (!user.email) throw new BadRequestException('У аккаунта нет привязанной почты для отправки кода');
    if (user.deletionRequestedAt) throw new BadRequestException('Удаление уже запланировано. Восстановление возможно в течение 14 дней.');

    const email = this.normalizeEmail(user.email);
    const since = new Date(Date.now() - EMAIL_RESEND_COOLDOWN_MS);
    const recent = await this.prisma.emailVerificationCode.count({
      where: { email, purpose: 'account_deletion', createdAt: { gte: since } },
    });
    if (recent > 0) {
      throw new BadRequestException('Повторная отправка кода возможна через 3 минуты');
    }

    const code = this.generateOtpCode();
    const codeHash = await this.hashOtp(code);
    const expiresAt = new Date(Date.now() + EMAIL_CODE_TTL_MS);
    await this.prisma.emailVerificationCode.create({
      data: { email, codeHash, purpose: 'account_deletion', expiresAt },
    });

    try {
      await this.emailService.sendVerificationCode({
        to: email,
        code,
        purpose: 'account_deletion',
        locale: locale ?? 'ru',
      });
    } catch (err) {
      this.logger.error(`requestAccountDeletion: failed to send email to ${email}`, err);
      throw new InternalServerErrorException(
        'Не удалось отправить письмо. Попробуйте позже.',
      );
    }
    return { message: 'ok', email };
  }

  /** Подтверждение удаления аккаунта по коду из почты. Аккаунт переводится в заморозку на 30 дней; восстановление возможно 14 дней. */
  async confirmAccountDeletion(userId: number, code: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, deletionRequestedAt: true },
    });
    if (!user) throw new UnauthorizedException('Пользователь не найден');
    if (!user.email) throw new BadRequestException('Нет привязанной почты');
    if (user.deletionRequestedAt) throw new BadRequestException('Удаление уже запланировано');

    const email = this.normalizeEmail(user.email);
    const record = await this.prisma.emailVerificationCode.findFirst({
      where: {
        email,
        purpose: 'account_deletion',
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) throw new UnauthorizedException('Неверный или истёкший код');
    if (record.attempts >= 5) throw new UnauthorizedException('Слишком много попыток. Запросите новый код.');

    const ok = await this.verifyOtpHash(record.codeHash, code.trim());
    if (!ok) {
      await this.prisma.emailVerificationCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Неверный код');
    }
    await this.prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    const now = new Date();
    const scheduledDeleteAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const restoreUntil = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        deletionRequestedAt: now,
        scheduledDeleteAt,
        restoreUntil,
      },
    });
    await this.prisma.refreshSession.deleteMany({ where: { userId } });
    return { message: 'ok', scheduledDeleteAt: scheduledDeleteAt.toISOString(), restoreUntil: restoreUntil.toISOString() };
  }

  /** Запрос кода на почту для восстановления аккаунта (аккаунт в заморозке, в течение 14 дней). Без авторизации. locale — язык письма. */
  async requestRestoreAccount(input: { email: string; locale?: 'ru' | 'en' }) {
    const email = this.normalizeEmail(input.email);
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, deletionRequestedAt: true, restoreUntil: true, scheduledDeleteAt: true },
    });
    if (!user || !user.deletionRequestedAt) {
      return { message: 'ok', email };
    }
    const now = new Date();
    if (user.restoreUntil && user.restoreUntil.getTime() < now.getTime()) {
      throw new BadRequestException('Срок восстановления (14 дней) истёк. Аккаунт будет удалён безвозвратно.');
    }

    const since = new Date(Date.now() - EMAIL_RESEND_COOLDOWN_MS);
    const recent = await this.prisma.emailVerificationCode.count({
      where: { email, purpose: 'account_restore', createdAt: { gte: since } },
    });
    if (recent > 0) {
      throw new BadRequestException('Повторная отправка кода возможна через 3 минуты');
    }

    const code = this.generateOtpCode();
    const codeHash = await this.hashOtp(code);
    const expiresAt = new Date(Date.now() + EMAIL_CODE_TTL_MS);
    await this.prisma.emailVerificationCode.create({
      data: { email, codeHash, purpose: 'account_restore', expiresAt },
    });
    try {
      await this.emailService.sendVerificationCode({
        to: email,
        code,
        purpose: 'account_restore',
        locale: input.locale ?? 'ru',
      });
    } catch (err) {
      this.logger.error(`requestRestoreAccount: failed to send email to ${email}`, err);
      throw new InternalServerErrorException('Не удалось отправить письмо. Попробуйте позже.');
    }
    return { message: 'ok', email };
  }

  /** Подтверждение восстановления аккаунта по коду. Снимает заморозку удаления. */
  async confirmRestoreAccount(input: { email: string; code: string }) {
    const email = this.normalizeEmail(input.email);
    const code = input.code.trim();

    const record = await this.prisma.emailVerificationCode.findFirst({
      where: {
        email,
        purpose: 'account_restore',
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) throw new UnauthorizedException('Неверный или истёкший код');
    if (record.attempts >= 5) throw new UnauthorizedException('Слишком много попыток. Запросите новый код.');

    const ok = await this.verifyOtpHash(record.codeHash, code);
    if (!ok) {
      await this.prisma.emailVerificationCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Неверный код');
    }
    await this.prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, deletionRequestedAt: true },
    });
    if (!user || !user.deletionRequestedAt) throw new BadRequestException('Аккаунт не в режиме удаления');

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        deletionRequestedAt: null,
        scheduledDeleteAt: null,
        restoreUntil: null,
      },
    });
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

