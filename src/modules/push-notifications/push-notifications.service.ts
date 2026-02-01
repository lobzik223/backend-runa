import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdatePushTokenDto } from './dto/update-push-token.dto';

/**
 * Push notification payload formats for iOS and Android
 */
export interface PushNotificationPayload {
  // Common fields
  title: string;
  body: string;
  data?: Record<string, any>;

  // iOS-specific (APNs)
  apns?: {
    payload: {
      aps: {
        alert: {
          title: string;
          body: string;
        };
        sound?: string;
        badge?: number;
      };
    };
  };

  // Android-specific (FCM)
  android?: {
    notification: {
      title: string;
      body: string;
      sound?: string;
      channelId?: string;
    };
    data?: Record<string, string>;
  };
}

@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger(PushNotificationsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Update or remove push token for a device
   */
  async updatePushToken(userId: number, dto: UpdatePushTokenDto) {
    const device = await this.prisma.device.findUnique({
      where: { deviceId: dto.deviceId },
    });

    if (!device) {
      // Create new device record
      return this.prisma.device.create({
        data: {
          deviceId: dto.deviceId,
          userId,
          platform: dto.platform || null,
          pushToken: dto.pushToken || null,
          pushTokenUpdatedAt: dto.pushToken ? new Date() : null,
        },
      });
    }

    // Update existing device
    return this.prisma.device.update({
      where: { deviceId: dto.deviceId },
      data: {
        userId,
        ...(dto.platform !== undefined && { platform: dto.platform }),
        ...(dto.pushToken !== undefined && {
          pushToken: dto.pushToken,
          pushTokenUpdatedAt: dto.pushToken ? new Date() : null,
        }),
        lastSeenAt: new Date(),
      },
    });
  }

  /**
   * Get all active push tokens for a user
   */
  async getUserPushTokens(userId: number): Promise<Array<{ token: string; platform: string | null }>> {
    const devices = await this.prisma.device.findMany({
      where: {
        userId,
        pushToken: { not: null },
      },
      select: {
        pushToken: true,
        platform: true,
      },
    });

    return devices
      .filter((d) => d.pushToken)
      .map((d) => ({
        token: d.pushToken!,
        platform: d.platform || 'unknown',
      }));
  }

  /**
   * Format notification message based on event kind
   */
  private formatNotificationMessage(kind: string, amount?: number | null, currency: string = 'RUB'): string {
    const formattedAmount = amount
      ? new Intl.NumberFormat('ru-RU', {
          style: 'currency',
          currency: currency,
          minimumFractionDigits: 0,
        }).format(Number(amount))
      : '';

    switch (kind) {
      case 'CREDIT_PAYMENT':
        return `Завтра день X. У тебя по плану финансовое действие: — 💳 Платёж по кредиту${formattedAmount ? ` ${formattedAmount}` : ''}. Не пропусти. Дисциплина = свобода.`;
      case 'DEPOSIT_INTEREST':
        return `Завтра день X. У тебя по плану финансовое действие: — 💰 Проценты по вкладу${formattedAmount ? ` ${formattedAmount}` : ''}. Не пропусти. Дисциплина = свобода.`;
      case 'GOAL_CONTRIBUTION':
        return `Завтра день X. У тебя по плану финансовое действие: — 🎯 Вклад в цель${formattedAmount ? ` ${formattedAmount}` : ''}. Не пропусти. Дисциплина = свобода.`;
      default:
        return `Завтра день X. У тебя по плану финансовое действие. Не пропусти. Дисциплина = свобода.`;
    }
  }

  /**
   * Create push notification payload for iOS (APNs)
   */
  createIOSPayload(title: string, body: string, data?: Record<string, any>): PushNotificationPayload {
    return {
      title,
      body,
      data,
      apns: {
        payload: {
          aps: {
            alert: {
              title,
              body,
            },
            sound: 'default',
            badge: 1,
          },
        },
      },
    };
  }

  /**
   * Create push notification payload for Android (FCM)
   */
  createAndroidPayload(title: string, body: string, data?: Record<string, any>): PushNotificationPayload {
    return {
      title,
      body,
      data,
      android: {
        notification: {
          title,
          body,
          sound: 'default',
          channelId: 'runa_finance_default',
        },
        data: data
          ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))
          : undefined,
      },
    };
  }

  /**
   * Create unified payload (works for both iOS and Android)
   */
  createUnifiedPayload(
    title: string,
    body: string,
    platform: string | null,
    data?: Record<string, any>,
  ): PushNotificationPayload {
    if (platform === 'ios') {
      return this.createIOSPayload(title, body, data);
    } else if (platform === 'android') {
      return this.createAndroidPayload(title, body, data);
    }

    // Default format (works for both)
    return {
      title,
      body,
      data,
      apns: {
        payload: {
          aps: {
            alert: { title, body },
            sound: 'default',
          },
        },
      },
      android: {
        notification: {
          title,
          body,
          sound: 'default',
        },
      },
    };
  }

  /**
   * Send push notification via Expo Push API.
   * Tokens are expected to be Expo push tokens from `expo-notifications`.
   */
  async sendPushNotification(
    token: string,
    platform: string | null,
    payload: PushNotificationPayload,
  ): Promise<boolean> {
    const isExpoToken =
      token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[') || token.startsWith('ExpoPushToken');

    if (!isExpoToken) {
      this.logger.warn(`[PUSH] Not an Expo token (${platform || 'unknown'}): ${token.substring(0, 20)}...`);
      return false;
    }

    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: token,
          title: payload.title,
          body: payload.body,
          data: payload.data,
          sound: 'default',
          channelId: 'runa_finance_default',
        }),
      });

      const json: any = await res.json().catch(() => null);
      const entry = Array.isArray(json?.data) ? json.data[0] : json?.data;
      const ok = res.ok && entry?.status === 'ok';

      if (!ok) {
        const err = entry?.message || entry?.details?.error || json?.errors?.[0]?.message || res.statusText;
        this.logger.warn(
          `[PUSH] Failed (${platform || 'unknown'}) ${token.substring(0, 20)}...: ${String(err)}`,
        );

        // If token is invalid/unregistered — clear it to avoid repeated failures
        const errStr = String(entry?.details?.error || err || '').toLowerCase();
        if (
          errStr.includes('device') ||
          errStr.includes('notregistered') ||
          errStr.includes('invalid') ||
          errStr.includes('push token')
        ) {
          await this.prisma.device.updateMany({
            where: { pushToken: token },
            data: { pushToken: null, pushTokenUpdatedAt: null },
          });
        }

        return false;
      }

      this.logger.log(
        `[PUSH] Sent (${platform || 'unknown'}) ${token.substring(0, 20)}...: ${payload.title}`,
      );
      return true;
    } catch (e) {
      this.logger.warn(`[PUSH] Error sending push: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * Send notification for a scheduled event
   */
  async sendScheduledEventNotification(
    userId: number,
    eventId: number,
    eventKind: string,
    amount: number | null,
    currency: string,
  ): Promise<void> {
    const tokens = await this.getUserPushTokens(userId);

    if (tokens.length === 0) {
      this.logger.warn(`[PUSH] No push tokens found for user ${userId}`);
      return;
    }

    const title = 'RUNA Finance';
    const body = this.formatNotificationMessage(eventKind, amount, currency);
    const data = {
      eventId: String(eventId),
      eventKind,
      ...(amount && { amount: String(amount) }),
      currency,
    };

    // Send to all user devices
    const results = await Promise.allSettled(
      tokens.map(({ token, platform }) =>
        this.sendPushNotification(token, platform, this.createUnifiedPayload(title, body, platform, data)),
      ),
    );

    const successCount = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    this.logger.log(
      `[PUSH] Sent notification for event ${eventId} to ${successCount}/${tokens.length} devices`,
    );

    // Update lastNotifiedAt if at least one notification was sent successfully
    if (successCount > 0) {
      await this.prisma.scheduledEvent.update({
        where: { id: eventId },
        data: { lastNotifiedAt: new Date() },
      });
    }
  }
}
