import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env } from '../../config/env.validation';

export type EmailPurpose = 'registration' | 'password_reset';

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
    this.transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: port === 465,
      auth: { user, pass },
    });
    return this.transporter;
  }

  private getFrom(): string {
    return env.SMTP_FROM ?? env.SMTP_USER ?? 'noreply@runafinance.online';
  }

  /**
   * Отправка кода на почту (подтверждение регистрации или сброс пароля).
   */
  async sendVerificationCode(params: {
    to: string;
    code: string;
    purpose: EmailPurpose;
  }): Promise<void> {
    const transporter = this.getTransporter();
    if (!transporter) {
      this.logger.warn(`[DEV Email] ${params.purpose} -> ${params.to}: code=${params.code}`);
      return;
    }

    const isRegistration = params.purpose === 'registration';
    const subject = isRegistration
      ? 'RUNA: код подтверждения регистрации'
      : 'RUNA: код для сброса пароля';
    const text = isRegistration
      ? `Ваш код подтверждения: ${params.code}\n\nКод действителен 15 минут.\n\nЕсли вы не регистрировались в RUNA, проигнорируйте это письмо.`
      : `Ваш код для сброса пароля: ${params.code}\n\nКод действителен 15 минут.\n\nЕсли вы не запрашивали сброс пароля, проигнорируйте это письмо.`;

    try {
      await transporter.sendMail({
        from: this.getFrom(),
        to: params.to,
        subject,
        text,
        html: `<p>${text.replaceAll('\n', '<br>')}</p>`,
      });
      this.logger.log(`Email sent to ${params.to} (${params.purpose})`);
    } catch (err) {
      this.logger.error(`Failed to send email to ${params.to}:`, err);
      throw err;
    }
  }
}
