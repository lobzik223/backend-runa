import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface MarketNewsItem {
  id: string;
  title: string;
  content: string;
  source?: string | null;
  sourceUrl?: string | null;
  publishedAt: Date;
}

/**
 * Market news service for Russian stock market news.
 * Currently uses placeholder data; ready for external API integration.
 */
@Injectable()
export class MarketNewsService {
  private readonly logger = new Logger(MarketNewsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get latest N news items
   */
  async getLatestNews(limit: number = 20): Promise<MarketNewsItem[]> {
    const news = await (this.prisma as any).marketNews.findMany({
      take: limit,
      orderBy: {
        publishedAt: 'desc',
      },
    });

    return news.map((n: any) => ({
      id: n.id,
      title: n.title,
      content: n.content,
      source: n.source,
      sourceUrl: n.sourceUrl,
      publishedAt: n.publishedAt,
    }));
  }

  /**
   * Admin: Insert news item manually
   */
  async insertNews(
    title: string,
    content: string,
    source?: string,
    sourceUrl?: string,
    publishedAt?: Date,
    externalId?: string,
  ) {
    return (this.prisma as any).marketNews.create({
      data: {
        title,
        content,
        source: source || null,
        sourceUrl: sourceUrl || null,
        publishedAt: publishedAt || new Date(),
        externalId: externalId || null,
      },
    });
  }

  /**
   * Fetch news from external API (placeholder - implement with real API)
   * This method should be called by a scheduled job
   */
  async fetchAndStoreNews() {
    this.logger.log('[MarketNews] Fetching news from external API...');

    // TODO: Implement real API integration
    // Example providers:
    // - Alpha Vantage News API
    // - NewsAPI.org
    // - MOEX official news feed
    // - RBC API
    // - TASS API

    // For now, this is a placeholder
    // In production, this would:
    // 1. Call external API
    // 2. Check externalId to avoid duplicates
    // 3. Store new items in DB

    this.logger.warn('[MarketNews] External API not configured, skipping fetch');
  }
}
