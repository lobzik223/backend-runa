import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import dayjs from 'dayjs';
import { env } from '../../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Data retention job:
 * - keep only the last N days of user history (default 90 days)
 * - after cleanup, neither the app nor AI can "see" older months
 */
@Injectable()
export class DataRetentionJob {
  private readonly logger = new Logger(DataRetentionJob.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs ежедневно в 03:10 (серверное время).
   * Можно менять расписание позже, но главное — стабильная чистка по cutoff.
   */
  @Cron('10 3 * * *')
  async run() {
    if (!env.DATA_RETENTION_ENABLED) return;

    const now = dayjs();
    const cutoff = now.subtract(env.DATA_RETENTION_DAYS, 'day').toDate();

    try {
      this.logger.log(
        `[Retention] Cleanup started. Keeping last ${env.DATA_RETENTION_DAYS} days. Cutoff: ${cutoff.toISOString()}`,
      );

      // IMPORTANT: delete children first to avoid FK issues.
      await this.prisma.$transaction([
        // Финансы (основная история)
        this.prisma.transaction.deleteMany({ where: { occurredAt: { lt: cutoff } } }),
        this.prisma.goalContribution.deleteMany({ where: { occurredAt: { lt: cutoff } } }),
        this.prisma.scheduledEvent.deleteMany({ where: { dueAt: { lt: cutoff } } }),

        // Инвестиции (сбрасываем историю сделок; пустые активы удаляем отдельно ниже)
        this.prisma.investmentLot.deleteMany({ where: { boughtAt: { lt: cutoff } } }),

        // AI/Нейронка (история диалогов и инсайтов)
        this.prisma.aiMessage.deleteMany({ where: { createdAt: { lt: cutoff } } }),
        this.prisma.aiInsight.deleteMany({ where: { createdAt: { lt: cutoff } } }),

        // Новости (можно держать меньше, но 90 дней ок)
        this.prisma.marketNews.deleteMany({ where: { publishedAt: { lt: cutoff } } }),
      ]);

      // Удаляем инвестиционные активы без лотов (после чистки лотов)
      await this.prisma.investmentAsset.deleteMany({
        where: {
          lots: { none: {} },
        },
      });

      // Удаляем пустые AI-треды (после чистки сообщений)
      await this.prisma.aiThread.deleteMany({
        where: {
          messages: { none: {} },
        },
      });

      this.logger.log('[Retention] Cleanup finished');
    } catch (e: any) {
      this.logger.error(`[Retention] Cleanup failed: ${e?.message ?? String(e)}`);
    }
  }

  /**
   * Безвозвратное удаление аккаунтов, у которых истёк срок заморозки (30 дней).
   * Запуск ежедневно в 04:00.
   */
  @Cron('0 4 * * *')
  async deleteScheduledAccounts() {
    const now = new Date();
    const usersToDelete = await this.prisma.user.findMany({
      where: {
        scheduledDeleteAt: { lte: now },
        deletionRequestedAt: { not: null },
      },
      select: { id: true, email: true },
    });
    if (usersToDelete.length === 0) return;

    this.logger.log(`[AccountDeletion] Permanently deleting ${usersToDelete.length} account(s)`);
    for (const u of usersToDelete) {
      try {
        await this.prisma.user.delete({ where: { id: u.id } });
        this.logger.log(`[AccountDeletion] Deleted user id=${u.id} email=${u.email ?? '(no email)'}`);
      } catch (e: any) {
        this.logger.error(`[AccountDeletion] Failed to delete user id=${u.id}: ${e?.message ?? String(e)}`);
      }
    }
  }
}

