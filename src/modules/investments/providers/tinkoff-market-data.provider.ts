import { Injectable, Logger } from '@nestjs/common';
import type { MarketDataProvider, AssetSearchResult } from '../interfaces/market-data-provider.interface';
import type { InvestmentAssetType } from '@prisma/client';
import { env } from '../../../config/env.validation';

/**
 * Tinkoff InvestAPI Market Data Provider
 * Uses Tinkoff InvestAPI gRPC to fetch real-time and historical market data
 */
const TINKOFF_PRODUCTION_URL = 'https://invest-public-api.tinkoff.ru/rest';
const TINKOFF_SANDBOX_URL = 'https://sandbox-invest-public-api.tinkoff.ru/rest';
const UNAUTHORIZED_WARN_COOLDOWN_MS = 5 * 60 * 1000; // не спамить лог 401 чаще раза в 5 минут

@Injectable()
export class TinkoffMarketDataProvider implements MarketDataProvider {
  private readonly logger = new Logger(TinkoffMarketDataProvider.name);
  private readonly apiToken: string;
  private readonly baseUrl: string;
  private readonly isSandbox: boolean;
  private lastUnauthorizedWarnAt = 0;

  constructor() {
    const rawDemo = env.TINKOFF_DEMO_TOKEN?.trim() ?? '';
    const rawProd = env.TINKOFF_TOKEN?.trim() ?? '';
    this.isSandbox = !!rawDemo;
    this.apiToken = rawDemo || rawProd;
    this.baseUrl = this.isSandbox ? TINKOFF_SANDBOX_URL : TINKOFF_PRODUCTION_URL;
    if (!this.apiToken) {
      this.logger.warn('Tinkoff API token not configured. TinkoffMarketDataProvider will not work.');
    } else {
      const prefix = this.apiToken.slice(0, 5);
      this.logger.log(
        `Tinkoff API initialized (${this.isSandbox ? 'SANDBOX' : 'PRODUCTION'}, baseUrl=${this.baseUrl}, token length=${this.apiToken.length}, prefix=${prefix}...)`,
      );
    }
  }

  /** Логировать 401 не чаще раза в 5 минут, чтобы не забивать логи. */
  private warnOnce401(context: string): void {
    const now = Date.now();
    if (now - this.lastUnauthorizedWarnAt < UNAUTHORIZED_WARN_COOLDOWN_MS) return;
    this.lastUnauthorizedWarnAt = now;
    this.logger.warn(
      `Tinkoff API 401 (${context}): токен не задан, неверный или просрочен. ` +
        'Песочница: TINKOFF_DEMO_TOKEN. Боевой: TINKOFF_TOKEN. См. docs/SETUP-TINKOFF.md',
    );
  }

  /**
   * Convert Tinkoff Quotation to number
   */
  private quotationToNumber(quotation: { units?: string | number; nano?: number } | null | undefined): number {
    if (!quotation) return 0;
    const units = typeof quotation.units === 'string' ? parseFloat(quotation.units) : (quotation.units || 0);
    const nano = quotation.nano || 0;
    return units + nano / 1_000_000_000;
  }

  /**
   * Get current price via Tinkoff REST API (simplified approach)
   * Note: Tinkoff InvestAPI is gRPC-based, but we'll use REST endpoints if available
   * For production, consider using @grpc/grpc-js with proto files
   */
  async getCurrentPrice(symbol: string, _exchange?: string | null): Promise<number | null> {
    if (!this.apiToken) {
      this.logger.warn('Tinkoff API token not configured');
      return null;
    }

    try {
      // First, find the instrument by ticker
      const instrument = await this.findInstrumentByTicker(symbol);
      if (!instrument) {
        return null;
      }

      // Get last price using Tinkoff InvestAPI REST endpoint
      // Note: Tinkoff InvestAPI is primarily gRPC-based, but we use REST wrapper
      const response = await fetch(`${this.baseUrl}/tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastPrices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify({
          figi: [instrument.figi],
        }),
      });

      if (!response.ok) {
        this.logger.warn(`Tinkoff API error: ${response.status} ${response.statusText}`);
        return null;
      }

      const data = await response.json() as { lastPrices?: Array<{ price?: { units?: string | number; nano?: number } }> };
      const lastPrice = data.lastPrices?.[0];
      if (!lastPrice) {
        return null;
      }

      return this.quotationToNumber(lastPrice.price);
    } catch (error) {
      this.logger.error(`Error fetching price for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get current prices for multiple assets (batch)
   */
  async getCurrentPricesBatch(
    symbols: Array<{ symbol: string; exchange?: string | null }>,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();

    if (!this.apiToken) {
      return result;
    }

    // Process in batches to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const promises = batch.map(async ({ symbol }) => {
        try {
          const price = await this.getCurrentPrice(symbol);
          if (price !== null) {
            result.set(symbol.toUpperCase(), price);
          }
        } catch (error) {
          this.logger.debug(`Failed to get price for ${symbol}:`, error);
        }
      });

      await Promise.all(promises);
      // Small delay to avoid rate limits
      if (i + batchSize < symbols.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return result;
  }

  /**
   * Search for assets by ticker or name
   */
  async searchAssets(
    query: string,
    assetType?: InvestmentAssetType | null,
  ): Promise<AssetSearchResult[]> {
    if (!this.apiToken) {
      this.logger.warn('Tinkoff API token not configured');
      return [];
    }

    try {
      const q = query.trim();
      if (!q) return [];

      // Search instruments
      const response = await fetch(`${this.baseUrl}/tinkoff.public.invest.api.contract.v1.InstrumentsService/FindInstrument`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify({
          query: q,
        }),
      });

      if (!response.ok) {
        if (response.status === 401) this.warnOnce401('search');
        return [];
      }

      const data = await response.json() as { instruments?: Array<{ ticker?: string; name?: string; instrumentType?: string; currency?: string; exchange?: string }> };
      const instruments = data.instruments || [];

      const results = instruments
        .slice(0, 20)
        .map((inst) => {
          const type = this.mapInstrumentType(inst.instrumentType);
          if (assetType && type !== assetType) {
            return null;
          }

          // Map InvestmentAssetType to AssetSearchResult type
          const resultType: AssetSearchResult['type'] = type as AssetSearchResult['type'];

          return {
            symbol: inst.ticker || '',
            name: inst.name || '',
            type: resultType,
            currency: inst.currency || 'RUB',
            exchange: inst.exchange || null,
          } as AssetSearchResult;
        })
        .filter((r): r is AssetSearchResult => r !== null);

      return results;
    } catch (error) {
      this.logger.error(`Error searching assets:`, error);
      return [];
    }
  }

  /**
   * Find instrument by ticker (internal helper)
   */
  private async findInstrumentByTicker(ticker: string): Promise<{ figi: string; ticker: string } | null> {
    try {
      const response = await fetch(`${this.baseUrl}/tinkoff.public.invest.api.contract.v1.InstrumentsService/FindInstrument`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify({
          query: ticker,
        }),
      });

      if (!response.ok) {
        if (response.status === 401) this.warnOnce401('FindInstrument');
        return null;
      }

      const data = await response.json() as { instruments?: Array<{ ticker?: string; figi?: string }> };
      const instruments = data.instruments || [];
      const match = instruments.find((inst) => 
        inst.ticker?.toUpperCase() === ticker.toUpperCase()
      );

      if (match && match.figi && match.ticker) {
        return {
          figi: match.figi,
          ticker: match.ticker,
        };
      }

      return null;
    } catch (error) {
      this.logger.error(`Error finding instrument:`, error);
      return null;
    }
  }

  /**
   * Map Tinkoff instrument type to our AssetType
   */
  private mapInstrumentType(tinkoffType?: string): InvestmentAssetType {
    const upper = tinkoffType?.toUpperCase() || '';
    if (upper.includes('SHARE') || upper === 'STOCK') return 'STOCK';
    if (upper.includes('BOND')) return 'BOND';
    if (upper.includes('ETF')) return 'ETF';
    if (upper.includes('CRYPTO') || upper.includes('CURRENCY')) return 'CRYPTO';
    if (upper.includes('FUTURE')) return 'OTHER';
    return 'OTHER';
  }

  /**
   * Get historical candles for an asset
   * @param figi FIGI identifier
   * @param from Start date
   * @param to End date
   * @param interval Candle interval (1_MIN, 5_MIN, 15_MIN, HOUR, DAY)
   */
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
    if (!this.apiToken) {
      this.logger.warn('Tinkoff API token not configured');
      return [];
    }

    try {
      const response = await fetch(`${this.baseUrl}/tinkoff.public.invest.api.contract.v1.MarketDataService/GetCandles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify({
          figi,
          from: from.toISOString(),
          to: to.toISOString(),
          interval: `CANDLE_INTERVAL_${interval}`,
        }),
      });

      if (!response.ok) {
        this.logger.warn(`Tinkoff candles error: ${response.status}`);
        return [];
      }

      const data = await response.json() as { candles?: Array<{
        time?: string;
        open?: { units?: string | number; nano?: number };
        high?: { units?: string | number; nano?: number };
        low?: { units?: string | number; nano?: number };
        close?: { units?: string | number; nano?: number };
        volume?: number;
      }> };
      const candles = data.candles || [];

      return candles.map((candle) => ({
        time: candle.time || new Date().toISOString(),
        open: this.quotationToNumber(candle.open),
        high: this.quotationToNumber(candle.high),
        low: this.quotationToNumber(candle.low),
        close: this.quotationToNumber(candle.close),
        volume: candle.volume || 0,
      }));
    } catch (error) {
      this.logger.error(`Error fetching candles:`, error);
      return [];
    }
  }

  /**
   * Get instrument by ticker (returns full instrument info including FIGI)
   */
  async getInstrumentByTicker(ticker: string): Promise<{
    figi: string;
    ticker: string;
    name: string;
    type: InvestmentAssetType;
    currency: string;
  } | null> {
    if (!this.apiToken) {
      return null;
    }

    try {
      // First try to find by ticker directly
      const figiResponse = await this.findInstrumentByTicker(ticker);
      if (figiResponse) {
        // Get full instrument info
        const instruments = await this.searchAssets(ticker);
        const match = instruments.find(inst => inst.symbol.toUpperCase() === ticker.toUpperCase());
        
        if (match) {
          const validType: InvestmentAssetType = match.type === 'FUTURES' ? 'OTHER' : match.type;
          return {
            figi: figiResponse.figi,
            ticker: match.symbol,
            name: match.name,
            type: validType,
            currency: match.currency,
          };
        }
      }

      // If direct search failed, try broader search
      const instruments = await this.searchAssets(ticker);
      const match = instruments.find(inst => 
        inst.symbol.toUpperCase() === ticker.toUpperCase() ||
        inst.symbol.toUpperCase().startsWith(ticker.toUpperCase())
      );
      
      if (match) {
        // Try to get FIGI for matched instrument
        const figiResponse = await this.findInstrumentByTicker(match.symbol);
        if (figiResponse) {
          const validType: InvestmentAssetType = match.type === 'FUTURES' ? 'OTHER' : match.type;
          return {
            figi: figiResponse.figi,
            ticker: match.symbol,
            name: match.name,
            type: validType,
            currency: match.currency,
          };
        }
      }

      this.logger.warn(`Instrument not found for ticker: ${ticker}`);
      return null;
    } catch (error) {
      this.logger.error(`Error getting instrument for ${ticker}:`, error);
      return null;
    }
  }
}
