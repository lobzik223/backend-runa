import { Injectable, Logger } from '@nestjs/common';
import Parser from 'rss-parser';
import { PrismaService } from '../prisma/prisma.service';

export interface MarketNewsItem {
  id: string;
  title: string;
  content: string;
  source?: string | null;
  sourceUrl?: string | null;
  publishedAt: Date;
}

type MarketNewsLang = 'ru' | 'en';

function getRssSources(lang: MarketNewsLang): { url: string; source: string }[] {
  const moexSource = lang === 'ru' ? 'Московская биржа' : 'Moscow Exchange';
  const cbrSource = lang === 'ru' ? 'ЦБ РФ' : 'Bank of Russia';
  return [
    { url: 'https://www.moex.com/export/news.aspx?cat=200', source: moexSource },
    { url: 'https://www.moex.com/export/news.aspx?cat=201', source: moexSource },
    { url: 'https://www.cbr.ru/rss/daily.asp', source: cbrSource },
  ];
}

const RSS_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function getAcceptLanguage(lang: MarketNewsLang): string {
  return lang === 'ru' ? 'ru-RU, ru;q=0.9, en;q=0.8' : 'en-US, en;q=0.9, ru;q=0.2';
}

@Injectable()
export class MarketNewsService {
  private readonly logger = new Logger(MarketNewsService.name);
  private readonly rssParser = new Parser({
    timeout: 15000,
    headers: { 'User-Agent': RSS_USER_AGENT, Accept: 'application/rss+xml, application/xml, text/xml' },
  });

  constructor(private prisma: PrismaService) {}

  /**
   * Get latest N news items. Сначала запрашиваем RSS с нужным языком (ru/en),
   * чтобы при русском интерфейсе приходили русские новости. Если RSS пустой — fallback на БД.
   */
  async getLatestNews(limit: number = 20, lang: MarketNewsLang = 'ru'): Promise<MarketNewsItem[]> {
    try {
      const fromRss = await this.fetchFromRss(limit, lang);
      if (fromRss.length > 0) return fromRss;
    } catch (e) {
      this.logger.warn('[MarketNews] RSS fetch failed, trying DB:', (e as Error).message);
    }

    try {
      const dbNews = await (this.prisma as any).marketNews.findMany({
        take: limit,
        orderBy: { publishedAt: 'desc' },
      });

      if (dbNews.length > 0) {
        return dbNews.map((n: any) => ({
          id: n.id,
          title: n.title,
          content: n.content,
          source: n.source,
          sourceUrl: n.sourceUrl,
          publishedAt: n.publishedAt,
        }));
      }
    } catch (e) {
      this.logger.warn('[MarketNews] DB read failed:', (e as Error).message);
    }

    return [];
  }

  /**
   * Fetch RSS by URL: сначала fetch, затем parseString (надёжнее для некоторых серверов).
   */
  private async fetchRssFeed(
    url: string,
    lang: MarketNewsLang,
  ): Promise<{
    items?: Array<{
      title?: string;
      link?: string;
      guid?: string;
      content?: string;
      contentSnippet?: string;
      pubDate?: string;
      isoDate?: string;
    }>;
  } | null> {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': RSS_USER_AGENT,
          Accept: 'application/rss+xml, application/xml, text/xml',
          'Accept-Language': getAcceptLanguage(lang),
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        this.logger.warn(`[MarketNews] RSS ${url} status ${res.status}`);
        return null;
      }
      const text = await res.text();
      return await this.rssParser.parseString(text);
    } catch (e) {
      this.logger.warn(`[MarketNews] RSS fetch ${url}:`, (e as Error).message);
      return null;
    }
  }

  /**
   * Загрузка новостей из RSS (MOEX, ЦБ РФ и т.д.).
   */
  private async fetchFromRss(limit: number, lang: MarketNewsLang): Promise<MarketNewsItem[]> {
    const seen = new Set<string>();
    const items: MarketNewsItem[] = [];

    for (const { url, source } of getRssSources(lang)) {
      if (items.length >= limit) break;
      const feed = await this.fetchRssFeed(url, lang);
      if (!feed?.items?.length) continue;
      for (const item of feed.items) {
        if (items.length >= limit) break;
        const link = item.link ?? item.guid ?? '';
        const id = link || `${source}-${item.title ?? Date.now()}-${items.length}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const title = (item.title ?? '').trim();
        if (!title) continue;
        const content =
          (item.contentSnippet ?? item.content ?? '').replace(/<[^>]+>/g, ' ').trim().slice(0, 6000) || title;
        const pubDate = item.pubDate ?? item.isoDate;
        items.push({
          id,
          title,
          content,
          source,
          sourceUrl: link || undefined,
          publishedAt: pubDate ? new Date(pubDate) : new Date(),
        });
      }
    }

    return items.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).slice(0, limit);
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
