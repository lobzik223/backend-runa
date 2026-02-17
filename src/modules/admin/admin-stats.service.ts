import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const ONLINE_MINUTES = 10;
const CHART_DAYS = 14;

@Injectable()
export class AdminStatsService {
  constructor(private prisma: PrismaService) {}

  async getDashboard() {
    const now = new Date();
    const tenMinAgo = new Date(now.getTime() - ONLINE_MINUTES * 60 * 1000);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [onlineCount, subscriptionsActive, usersToday, newRegistrations, chartData] = await Promise.all([
      this.prisma.device.count({ where: { lastSeenAt: { gte: tenMinAgo } } }),
      this.prisma.subscription.count({
        where: {
          status: 'ACTIVE',
          currentPeriodEnd: { gte: now },
        },
      }),
      this.prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
      this.prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      this.getRegistrationsChartData(),
    ]);

    return {
      usersOnline: onlineCount,
      subscriptionsActive,
      usersToday,
      newRegistrations,
      chartData,
    };
  }

  private async getRegistrationsChartData(): Promise<{ date: string; count: number }[]> {
    const start = new Date();
    start.setDate(start.getDate() - CHART_DAYS);
    start.setHours(0, 0, 0, 0);

    const users = await this.prisma.user.findMany({
      where: { createdAt: { gte: start } },
      select: { createdAt: true },
    });

    const byDay: Record<string, number> = {};
    for (let d = 0; d < CHART_DAYS; d++) {
      const day = new Date(start);
      day.setDate(day.getDate() + d);
      byDay[day.toISOString().slice(0, 10)] = 0;
    }
    for (const u of users) {
      const key = u.createdAt.toISOString().slice(0, 10);
      if (byDay[key] !== undefined) byDay[key]++;
    }

    return Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));
  }
}
