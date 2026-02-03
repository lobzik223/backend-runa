import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env } from '../../config/env.validation';

export type EmailPurpose = 'registration' | 'password_reset' | 'account_deletion' | 'account_restore';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter | null {
    if (this.transporter) return this.transporter;
    const host = env.SMTP_HOST;
    const port = env.SMTP_PORT ?? 465;
    const user = env.SMTP_USER;
    const pass = env.SMTP_PASS;
    if (!host || !user || !pass) {
      this.logger.warn('SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS). Emails will not be sent.');
      return null;
    }
    const portNum = Number(port);
    this.transporter = nodemailer.createTransport({
      host,
      port: portNum,
      secure: portNum === 465,
      auth: { user, pass },
      connectionTimeout: 20000,
      greetingTimeout: 15000,
    });
    return this.transporter;
  }

  /** Адрес отправителя (для SMTP). */
  private getFromAddress(): string {
    return env.SMTP_FROM ?? env.SMTP_USER ?? 'noreply@runafinance.online';
  }

  /** Строка From для письма: "Runa Finance <noreply@runafinance.online>" — так в почте видно имя, а не только noreply. */
  private getFrom(): string {
    const address = this.getFromAddress();
    return `Runa Finance <${address}>`;
  }

  /**
   * Отправка кода на почту через SMTP. Язык письма задаётся locale (ru/en).
   */
  async sendVerificationCode(params: {
    to: string;
    code: string;
    purpose: EmailPurpose;
    locale?: 'ru' | 'en';
  }): Promise<void> {
    const transporter = this.getTransporter();
    if (!transporter) {
      this.logger.warn(`SMTP not configured. Would send ${params.purpose} -> ${params.to}: code=${params.code}`);
      return;
    }

    const isEn = params.locale === 'en';
    let subject: string;
    let text: string;

    if (params.purpose === 'registration') {
      subject = isEn ? 'RUNA: registration verification code' : 'RUNA: код подтверждения регистрации';
      text = isEn
        ? `Your verification code: ${params.code}\n\nCode is valid for 15 minutes.\n\nIf you did not register with RUNA, ignore this email.`
        : `Ваш код подтверждения: ${params.code}\n\nКод действителен 15 минут.\n\nЕсли вы не регистрировались в RUNA, проигнорируйте это письмо.`;
    } else if (params.purpose === 'password_reset') {
      subject = isEn ? 'RUNA: password reset code' : 'RUNA: код для сброса пароля';
      text = isEn
        ? `Your password reset code: ${params.code}\n\nCode is valid for 15 minutes.\n\nIf you did not request a password reset, ignore this email.`
        : `Ваш код для сброса пароля: ${params.code}\n\nКод действителен 15 минут.\n\nЕсли вы не запрашивали сброс пароля, проигнорируйте это письмо.`;
    } else if (params.purpose === 'account_deletion') {
      subject = isEn ? 'RUNA: account deletion confirmation code' : 'RUNA: код для подтверждения удаления аккаунта';
      text = isEn
        ? `Your account deletion confirmation code: ${params.code}\n\nCode is valid for 15 minutes. After confirmation the account will be frozen for 30 days; you can restore within 14 days.\n\nIf you did not request deletion, ignore this email.`
        : `Ваш код для подтверждения удаления аккаунта: ${params.code}\n\nКод действителен 15 минут. После подтверждения аккаунт будет заморожен на 30 дней; восстановление возможно в течение 14 дней.\n\nЕсли вы не запрашивали удаление, проигнорируйте это письмо.`;
    } else {
      subject = isEn ? 'RUNA: account restoration code' : 'RUNA: код для восстановления аккаунта';
      text = isEn
        ? `Your account restoration code: ${params.code}\n\nCode is valid for 15 minutes.\n\nIf you did not request restoration, ignore this email.`
        : `Ваш код для восстановления аккаунта: ${params.code}\n\nКод действителен 15 минут.\n\nЕсли вы не запрашивали восстановление, проигнорируйте это письмо.`;
    }

    try {
      await transporter.sendMail({
        from: this.getFrom(),
        to: params.to,
        subject,
        text,
        html: `<p>${text.replaceAll('\n', '<br>')}</p>`,
      });
      this.logger.log(`Email sent to ${params.to} (${params.purpose}, ${params.locale ?? 'ru'})`);
    } catch (err) {
      this.logger.error(`Failed to send email to ${params.to}:`, err);
      throw new ServiceUnavailableException(
        isEn ? 'Failed to send email. Please try again later.' : 'Не удалось отправить письмо. Попробуйте позже.',
      );
    }
  }
}
