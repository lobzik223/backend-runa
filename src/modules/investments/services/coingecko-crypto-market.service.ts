import { Injectable, Logger } from '@nestjs/common';
import { DEMO_CRYPTO_QUOTES, type DemoCryptoQuote } from '../constants/demo-crypto-quotes';

const MARKETS_URL =
  'https://api.coingecko.com/api/v3/coins/markets?vs_currency=rub&order=market_cap_desc&per_page=65&page=1&sparkline=false&locale=en';

type CoinGeckoMarketRow = {
  symbol: string;
  name: string;
  image: string;
  current_price: number | null;
  price_change_percentage_24h: number | null;
};

const ACCENT_HINT: Record<string, string> = {
  BTC: '#F7931A',
  ETH: '#627EEA',
  TON: '#0098EA',
  SOL: '#9945FF',
  XRP: '#23292F',
  DOGE: '#C2A633',
  TRX: '#FF060A',
  ADA: '#0033AD',
  BNB: '#F3BA2F',
  DOT: '#E6007A',
  POL: '#8247E5',
  MATIC: '#8247E5',
  AVAX: '#E84142',
  LINK: '#2A5ADA',
  LTC: '#345D9D',
  ATOM: '#2E3148',
  UNI: '#FF007A',
  NEAR: '#000000',
  APT: '#1D1F3B',
  SHIB: '#E0982B',
};

function accentFromSymbol(sym: string): string {
  return ACCENT_HINT[sym.toUpperCase()] ?? '#5C6BE8';
}

@Injectable()
export class CoinGeckoCryptoMarketService {
  private readonly logger = new Logger(CoinGeckoCryptoMarketService.name);
  private cache: { atMs: number; rows: DemoCryptoQuote[] } | null = null;

  private static readonly TTL_MS = 55_000;

  private staticRows(): DemoCryptoQuote[] {
    return [...DEMO_CRYPTO_QUOTES];
  }

  async fetchMarketRows(): Promise<DemoCryptoQuote[]> {
    const now = Date.now();
    if (this.cache && now - this.cache.atMs < CoinGeckoCryptoMarketService.TTL_MS) {
      return this.cache.rows;
    }

    try {
      const res = await fetch(MARKETS_URL, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        throw new Error(`CoinGecko HTTP ${res.status}`);
      }
      const raw = (await res.json()) as CoinGeckoMarketRow[];
      if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('CoinGecko: пустой ответ');
      }

      const rows: DemoCryptoQuote[] = raw.map((r) => {
        const sym = String(r.symbol || '').toUpperCase();
        const price = Number(r.current_price ?? 0);
        const pct = Number(r.price_change_percentage_24h ?? 0);
        return {
          symbol: sym || '?',
          name: r.name || sym,
          priceRub: Number.isFinite(price) ? Math.round(price * 100) / 100 : 0,
          change24hPct: Number.isFinite(pct) ? Math.round(pct * 100) / 100 : 0,
          accent: accentFromSymbol(sym),
          imageUrl: r.image || '',
        };
      });

      const withIcon = rows.filter((x) => x.imageUrl.length > 0);
      const dedup = this.uniqBySymbol(withIcon);

      if (dedup.length < 15) {
        return this.warnAndReturnStatic('мало строк после фильтра');
      }

      this.cache = { atMs: now, rows: dedup };
      return dedup;
    } catch (e: unknown) {
      return this.warnAndReturnStatic(String((e as Error)?.message || e || 'ошибка'));
    }
  }

  private uniqBySymbol(rows: DemoCryptoQuote[]): DemoCryptoQuote[] {
    const seen = new Set<string>();
    const out: DemoCryptoQuote[] = [];
    for (const r of rows) {
      if (!r.symbol || seen.has(r.symbol)) continue;
      seen.add(r.symbol);
      out.push(r);
    }
    return out;
  }

  private warnAndReturnStatic(reason: string): DemoCryptoQuote[] {
    this.logger.warn(`Криптокотировки: статический fallback (${reason})`);
    return this.staticRows();
  }
}
