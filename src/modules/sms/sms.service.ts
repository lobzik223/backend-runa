import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env.validation';

/**
 * SMS provider abstraction.
 *
 * Production: integrate Twilio / AWS SNS / SMS.RU / etc.
 * Development fallback: logs OTP to server logs (no real SMS).
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  async sendOtp(params: { phoneE164: string; code: string }): Promise<void> {
    // For now: feasibility fallback is built-in.
    // We can swap based on env later without changing AuthService.
    if (env.NODE_ENV === 'production') {
      // Not implemented: requires SMS provider credentials and legal sender setup.
      // Safer than silently "pretending" to send.
      throw new Error('SMS provider not configured for production');
    }

    this.logger.warn(`[DEV OTP] ${params.phoneE164} -> ${params.code}`);
  }
}

