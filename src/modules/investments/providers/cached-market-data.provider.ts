import { Injectable, Logger } from '@nestjs/common';
import { MarketDataProvider } from '../interfaces/market-data-provider.interface';
import Redis from 'ioredis';
import { env } from '../../../config/env.validation';

/**
 * Cached wrapper for MarketDataProvider.
 * Caches prices for 10 minutes (configurable) to reduce API calls.
 */
@Injectable()
export class CachedMarketDataProvider implements MarketDataProvider {
  private readonly logger = new Logger(CachedMarketDataProvider.name);
  private readonly redis: Redis;
  private readonly cacheTtlSeconds = 10 * 60; // 10 minutes default

  constructor(private readonly provider: MarketDataProvider) {
    this.redis = new Redis(env.REDIS_URL);
  }

  async getCurrentPrice(symbol: string, exchange?: string | null): Promise<number | null> {
    const cacheKey = this.getCacheKey(symbol, exchange);

    // Try cache first
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) {
        const price = parseFloat(cached);
        if (!isNaN(price)) {
          return price;
        }
      }
    } catch (error) {
      this.logger.warn(`Cache read error for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Fetch from provider
    const price = await this.provider.getCurrentPrice(symbol, exchange);

    // Cache result (even null to avoid repeated lookups for missing tickers)
    if (price !== null) {
      try {
        await this.redis.setex(cacheKey, this.cacheTtlSeconds, price.toString());
      } catch (error) {
        this.logger.warn(`Cache write error for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return price;
  }

  async getCurrentPricesBatch(
    symbols: Array<{ symbol: string; exchange?: string | null }>,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const uncachedSymbols: Array<{ symbol: string; exchange?: string | null }> = [];

    // Try to get from cache
    const cacheKeys = symbols.map((s) => this.getCacheKey(s.symbol, s.exchange));
    try {
      const cachedValues = cacheKeys.length > 0 ? await this.redis.mget(...cacheKeys) : [];
      for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i];
        if (!symbol) continue;
        const cached = cachedValues[i];
        if (cached !== null && cached !== undefined) {
          const price = parseFloat(cached);
          if (!isNaN(price)) {
            result.set(symbol.symbol.toUpperCase(), price);
          } else {
            uncachedSymbols.push(symbol);
          }
        } else {
          uncachedSymbols.push(symbol);
        }
      }
    } catch (error) {
      this.logger.warn(`Batch cache read error: ${error instanceof Error ? error.message : String(error)}`);
      // If cache fails, fetch all
      uncachedSymbols.push(...symbols);
    }

    // Fetch uncached symbols from provider
    if (uncachedSymbols.length > 0) {
      const providerResults = await this.provider.getCurrentPricesBatch(uncachedSymbols);

      // Cache results
      const pipeline = this.redis.pipeline();
      for (const { symbol, exchange } of uncachedSymbols) {
        const price = providerResults.get(symbol.toUpperCase());
        if (price !== undefined) {
          result.set(symbol.toUpperCase(), price);
          const cacheKey = this.getCacheKey(symbol, exchange);
          pipeline.setex(cacheKey, this.cacheTtlSeconds, price.toString());
        }
      }
      try {
        await pipeline.exec();
      } catch (error) {
        this.logger.warn(`Batch cache write error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return result;
  }

  async searchAssets(
    query: string,
    assetType?: 'STOCK' | 'BOND' | 'ETF' | 'FUTURES' | 'CRYPTO' | 'OTHER' | null,
  ) {
    // Search is not cached (results change frequently)
    return this.provider.searchAssets(query, assetType);
  }

  // Proxy methods for TinkoffMarketDataProvider
  async getInstrumentByTicker(ticker: string): Promise<{
    figi: string;
    ticker: string;
    name: string;
    type: any;
    currency: string;
  } | null> {
    const provider = this.provider as any;
    if (typeof provider.getInstrumentByTicker === 'function') {
      return provider.getInstrumentByTicker(ticker);
    }
    return null;
  }

  async getCandles(
    figi: string,
    from: Date,
    to: Date,
    interval: '1_MIN' | '5_MIN' | '15_MIN' | 'HOUR' | 'DAY' = 'DAY',
  ): Promise<Array<{
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>> {
    const provider = this.provider as any;
    if (typeof provider.getCandles === 'function') {
      return provider.getCandles(figi, from, to, interval);
    }
    return [];
  }

  private getCacheKey(symbol: string, exchange?: string | null): string {
    const upperSymbol = symbol.toUpperCase();
    const exchangePart = exchange ? `:${exchange.toUpperCase()}` : '';
    return `market:price:${upperSymbol}${exchangePart}`;
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
