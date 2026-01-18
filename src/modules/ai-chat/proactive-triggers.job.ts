import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import dayjs from 'dayjs';

/**
 * Proactive AI triggers job.
 * Runs periodically to detect financial anomalies and create AI insights.
 */
@Injectable()
export class ProactiveTriggersJob {
  private readonly logger = new Logger(ProactiveTriggersJob.name);

  // Configurable thresholds (can be per-user later)
  private readonly EXPENSE_SPIKE_THRESHOLD = 0.3; // 30% increase
  private readonly INACTIVITY_DAYS = 7; // 7 days without transactions

  constructor(
    private prisma: PrismaService,
    private pushNotificationsService: PushNotificationsService,
  ) {}

  /**
   * Run every 6 hours to check for triggers
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async checkTriggers() {
    this.logger.log('[ProactiveTriggers] Checking for financial triggers...');

    try {
      // Get all active users
      const users = await this.prisma.user.findMany({
        select: { id: true },
      });

      for (const user of users) {
        try {
          await this.checkUserTriggers(user.id);
        } catch (error) {
          this.logger.error(`[ProactiveTriggers] Error for user ${user.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      this.logger.log('[ProactiveTriggers] Completed trigger checks');
    } catch (error) {
      this.logger.error(`[ProactiveTriggers] Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async checkUserTriggers(userId: number) {
    // Trigger 1: Expense spike (week-over-week)
    await this.checkExpenseSpike(userId);

    // Trigger 2: Budget deficit
    await this.checkBudgetDeficit(userId);

    // Trigger 3: User inactivity
    await this.checkInactivity(userId);

    // Trigger 4: Goal achieved
    await this.checkGoalAchieved(userId);
  }

  private async checkExpenseSpike(userId: number) {
    const now = dayjs();
    const thisWeekStart = now.subtract(7, 'days').startOf('day').toDate();
    const thisWeekEnd = now.toDate();
    const lastWeekStart = now.subtract(14, 'days').startOf('day').toDate();
    const lastWeekEnd = now.subtract(7, 'days').endOf('day').toDate();

    const thisWeekExpenses = await this.getExpenseTotal(userId, thisWeekStart, thisWeekEnd);
    const lastWeekExpenses = await this.getExpenseTotal(userId, lastWeekStart, lastWeekEnd);

    if (lastWeekExpenses > 0) {
      const increase = (thisWeekExpenses - lastWeekExpenses) / lastWeekExpenses;
      if (increase >= this.EXPENSE_SPIKE_THRESHOLD) {
        await this.createInsight(
          userId,
          'expense_spike',
          'Резкий рост расходов',
          `Ваши расходы выросли на ${(increase * 100).toFixed(1)}% по сравнению с прошлой неделей`,
          'warning',
          { increasePercent: increase * 100, thisWeek: thisWeekExpenses, lastWeek: lastWeekExpenses },
        );
      }
    }
  }

  private async checkBudgetDeficit(userId: number) {
    const now = dayjs();
    const monthStart = now.startOf('month').toDate();
    const monthEnd = now.endOf('month').toDate();

    const income = await this.getIncomeTotal(userId, monthStart, monthEnd);
    const expense = await this.getExpenseTotal(userId, monthStart, monthEnd);

    if (expense > income) {
      const deficit = expense - income;
      await this.createInsight(
        userId,
        'budget_deficit',
        'Дефицит бюджета',
        `В этом месяце расходы превышают доходы на ${deficit.toLocaleString('ru-RU')} ₽`,
        'critical',
        { deficit, income, expense },
      );
    }
  }

  private async checkInactivity(userId: number) {
    const lastTransaction = await this.prisma.transaction.findFirst({
      where: { userId },
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    });

    if (lastTransaction) {
      const daysSince = dayjs().diff(dayjs(lastTransaction.occurredAt), 'day');
      if (daysSince >= this.INACTIVITY_DAYS) {
        await this.createInsight(
          userId,
          'inactivity',
          'Долгое отсутствие активности',
          `Вы не добавляли транзакции уже ${daysSince} дней. Не забывайте отслеживать свои финансы!`,
          'info',
          { daysInactive: daysSince },
        );
      }
    }
  }

  private async checkGoalAchieved(userId: number) {
    const goals = await this.prisma.goal.findMany({
      where: {
        userId,
        status: 'ACTIVE',
      },
      include: {
        contributions: true,
      },
    });

    for (const goal of goals) {
      const currentAmount = goal.contributions.reduce((sum, c) => sum + Number(c.amount), 0);
      const targetAmount = Number(goal.targetAmount);

      if (currentAmount >= targetAmount) {
        await this.createInsight(
          userId,
          'goal_achieved',
          `Цель "${goal.name}" достигнута!`,
          `Поздравляем! Вы достигли цели "${goal.name}"`,
          'info',
          { goalId: goal.id, goalName: goal.name },
        );

        // Mark goal as completed
        await this.prisma.goal.update({
          where: { id: goal.id },
          data: { status: 'COMPLETED' },
        });
      }
    }
  }

  private async getExpenseTotal(userId: number, start: Date, end: Date): Promise<number> {
    const result = await this.prisma.transaction.aggregate({
      where: {
        userId,
        type: 'EXPENSE',
        occurredAt: { gte: start, lte: end },
      },
      _sum: { amount: true },
    });
    return Number(result._sum.amount || 0);
  }

  private async getIncomeTotal(userId: number, start: Date, end: Date): Promise<number> {
    const result = await this.prisma.transaction.aggregate({
      where: {
        userId,
        type: 'INCOME',
        occurredAt: { gte: start, lte: end },
      },
      _sum: { amount: true },
    });
    return Number(result._sum.amount || 0);
  }

  private async createInsight(
    userId: number,
    type: string,
    title: string,
    message: string,
    severity: string,
    metadata?: Record<string, any>,
  ) {
    // Check if similar insight already exists (not acknowledged)
    const existing = await (this.prisma as any).aiInsight.findFirst({
      where: {
        userId,
        type,
        acknowledgedAt: null,
        createdAt: {
          gte: dayjs().subtract(24, 'hours').toDate(), // Within last 24 hours
        },
      },
    });

    if (existing) {
      return; // Don't create duplicate
    }

    // Create insight
    const insight = await (this.prisma as any).aiInsight.create({
      data: {
        userId,
        type,
        title,
        message,
        severity,
        metadata: metadata || {},
      },
    });

    // Send push notification
    try {
      await this.pushNotificationsService.sendScheduledEventNotification(
        userId,
        insight.id,
        'AI_INSIGHT',
        null,
        'RUB',
      );
    } catch (error) {
      this.logger.warn(`Failed to send push for insight ${insight.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
