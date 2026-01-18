import { Injectable, Logger } from '@nestjs/common';
import type { MarketDataProvider, AssetSearchResult } from '../interfaces/market-data-provider.interface';
import type { InvestmentAssetType } from '@prisma/client';

type MoexMarketDataResponse = {
  marketdata?: { columns: string[]; data: any[][] };
};

type MoexSecuritiesResponse = {
  securities?: { columns: string[]; data: any[][] };
};

function pickNumber(row: any[] | undefined, columns: string[], keys: string[]): number | null {
  if (!row) return null;
  for (const k of keys) {
    const idx = columns.indexOf(k);
    if (idx >= 0) {
      const v = row[idx];
      const n = typeof v === 'number' ? v : v != null ? Number(v) : NaN;
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

@Injectable()
export class MoexMarketDataProvider implements MarketDataProvider {
  private readonly logger = new Logger(MoexMarketDataProvider.name);
  private readonly base = 'https://iss.moex.com/iss';

  private async fetchJson<T>(path: string): Promise<T> {
    const url = `${this.base}${path}`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      throw new Error(`MOEX ISS error ${res.status}`);
    }
    return (await res.json()) as T;
  }

  async getCurrentPrice(symbol: string, _exchange?: string): Promise<number | null> {
    const secid = symbol.trim().toUpperCase();
    if (!secid) return null;

    // Try shares first, then bonds (covers most RF retail cases)
    const paths = [
      `/engines/stock/markets/shares/securities/${encodeURIComponent(secid)}.json?iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,LAST,LCURRENTPRICE,MARKETPRICE,BOARDID`,
      `/engines/stock/markets/bonds/securities/${encodeURIComponent(secid)}.json?iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,LAST,LCURRENTPRICE,MARKETPRICE,BOARDID`,
    ];

    for (const p of paths) {
      try {
        const json = await this.fetchJson<MoexMarketDataResponse>(p);
        const cols = json.marketdata?.columns || [];
        const row = json.marketdata?.data?.[0];
        const price = pickNumber(row, cols, ['LAST', 'LCURRENTPRICE', 'MARKETPRICE']);
        if (price !== null) return price;
      } catch {
        // continue
      }
    }

    return null;
  }

  async getCurrentPricesBatch(
    symbols: Array<{ symbol: string; exchange?: string | null }>,
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();

    // Small concurrency to avoid load; keep it lightweight
    const limit = 4;
    const queue = symbols.map((s) => ({ symbol: s.symbol, exchange: s.exchange || undefined }));
    const workers = Array.from({ length: Math.min(limit, queue.length) }).map(async () => {
      while (queue.length) {
        const item = queue.shift();
        if (!item) break;
        const key = item.symbol.toUpperCase();
        try {
          const price = await this.getCurrentPrice(item.symbol, item.exchange);
          if (price !== null) out.set(key, price);
        } catch (e: any) {
          this.logger.debug(`MOEX price failed for ${key}: ${e?.message || e}`);
        }
      }
    });

    await Promise.all(workers);
    return out;
  }

  async searchAssets(query: string, assetType?: InvestmentAssetType): Promise<AssetSearchResult[]> {
    const q = query.trim();
    if (!q) return [];

    // MOEX securities search (best-effort)
    const json = await this.fetchJson<MoexSecuritiesResponse>(
      `/securities.json?q=${encodeURIComponent(q)}&iss.meta=off&iss.only=securities&securities.columns=secid,shortname,name`,
    );

    const cols = json.securities?.columns || [];
    const rows = json.securities?.data || [];

    const secidIdx = cols.indexOf('secid');
    const nameIdx = cols.indexOf('name');
    const shortIdx = cols.indexOf('shortname');

    const mapped: AssetSearchResult[] = rows
      .slice(0, 10)
      .map((r) => {
        const symbol = String(r[secidIdx] || '').toUpperCase();
        const name = String(r[nameIdx] || r[shortIdx] || symbol);
        return {
          symbol,
          name,
          type: assetType || 'STOCK',
          currency: 'RUB',
          exchange: 'MOEX',
        };
      })
      .filter((x) => x.symbol.length > 0);

    return mapped;
  }
}

