import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PushNotificationsService } from './push-notifications.service';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Background job that runs every hour to check for scheduled events
 * occurring tomorrow and sends push notifications.
 *
 * Deduplication: Uses lastNotifiedAt to prevent sending duplicate notifications.
 */
@Injectable()
export class ScheduledEventsNotificationJob {
  private readonly logger = new Logger(ScheduledEventsNotificationJob.name);

  constructor(
    private prisma: PrismaService,
    private pushNotificationsService: PushNotificationsService,
  ) {}

  /**
   * Run every hour at minute 0 (e.g., 00:00, 01:00, 02:00, ...)
   * Alternative: Use CronExpression.EVERY_DAY_AT_9AM for daily at 9 AM
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleScheduledEventsNotifications() {
    this.logger.log('[JOB] Checking for scheduled events occurring tomorrow...');

    try {
      // Get current date and tomorrow's date range (start and end of day)
      const now = dayjs();
      const tomorrowStart = now.add(1, 'day').startOf('day').toDate();
      const tomorrowEnd = now.add(1, 'day').endOf('day').toDate();

      // Find all scheduled events that:
      // 1. Occur tomorrow (dueAt between tomorrowStart and tomorrowEnd)
      // 2. Are in SCHEDULED status
      // 3. Have not been notified yet (lastNotifiedAt is null) OR
      //    were notified more than 23 hours ago (to allow re-notification if needed)
      const events = await this.prisma.scheduledEvent.findMany({
        where: {
          status: 'SCHEDULED',
          dueAt: {
            gte: tomorrowStart,
            lte: tomorrowEnd,
          },
          // Deduplication: only notify if lastNotifiedAt is null or was more than 23 hours ago
          OR: [
            { lastNotifiedAt: null },
            {
              lastNotifiedAt: {
                lt: now.subtract(23, 'hour').toDate(),
              },
            },
          ],
        },
        include: {
          user: {
            select: {
              id: true,
            },
          },
        },
      });

      this.logger.log(`[JOB] Found ${events.length} events to notify`);

      // Process each event
      for (const event of events) {
        try {
          await this.pushNotificationsService.sendScheduledEventNotification(
            event.userId,
            event.id,
            event.kind,
            event.amount ? Number(event.amount) : null,
            event.currency,
          );
        } catch (error) {
          this.logger.error(
            `[JOB] Failed to send notification for event ${event.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
          // Continue with other events even if one fails
        }
      }

      this.logger.log(`[JOB] Completed processing ${events.length} events`);
    } catch (error) {
      this.logger.error(
        `[JOB] Error in scheduled events notification job: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
