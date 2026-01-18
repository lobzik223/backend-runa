import { Controller, Get, Query, ParseIntPipe, Post, Body, UseGuards } from '@nestjs/common';
import { MarketNewsService } from './market-news.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';

@Controller('market-news')
export class MarketNewsController {
  constructor(private readonly marketNewsService: MarketNewsService) {}

  /**
   * Get latest market news
   * GET /api/market-news?limit=20
   */
  @Get()
  getLatestNews(@Query('limit', new ParseIntPipe({ optional: true })) limit?: number) {
    return this.marketNewsService.getLatestNews(limit || 20);
  }

  /**
   * Admin endpoint: Insert news manually
   * POST /api/market-news/admin/insert
   * TODO: Add admin guard
   */
  @Post('admin/insert')
  @UseGuards(JwtAccessGuard)
  insertNews(@Body() body: { title: string; content: string; source?: string; sourceUrl?: string; publishedAt?: string; externalId?: string }) {
    return this.marketNewsService.insertNews(
      body.title,
      body.content,
      body.source,
      body.sourceUrl,
      body.publishedAt ? new Date(body.publishedAt) : undefined,
      body.externalId,
    );
  }
}
