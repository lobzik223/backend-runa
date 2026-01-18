import { Injectable } from '@nestjs/common';
import { MarketDataProvider, AssetSearchResult } from '../interfaces/market-data-provider.interface';

/**
 * Mock market data provider for testing and development.
 * Returns predictable test data without external API calls.
 */
@Injectable()
export class MockMarketDataProvider implements MarketDataProvider {
  // Mock price database (symbol -> price)
  private readonly mockPrices: Record<string, number> = {
    AAPL: 175.50,
    GOOGL: 142.30,
    MSFT: 378.85,
    SBER: 285.50,
    GAZP: 165.20,
    YNDX: 2450.00,
    BTC: 45000.00,
    ETH: 2800.00,
    SPY: 450.25,
    QQQ: 380.50,
  };

  // Mock asset database (symbol -> asset info)
  private readonly mockAssets: Record<string, AssetSearchResult> = {
    AAPL: {
      symbol: 'AAPL',
      name: 'Apple Inc.',
      type: 'STOCK',
      currency: 'USD',
      exchange: 'NASDAQ',
    },
    GOOGL: {
      symbol: 'GOOGL',
      name: 'Alphabet Inc.',
      type: 'STOCK',
      currency: 'USD',
      exchange: 'NASDAQ',
    },
    MSFT: {
      symbol: 'MSFT',
      name: 'Microsoft Corporation',
      type: 'STOCK',
      currency: 'USD',
      exchange: 'NASDAQ',
    },
    SBER: {
      symbol: 'SBER',
      name: 'Сбербанк',
      type: 'STOCK',
      currency: 'RUB',
      exchange: 'MOEX',
    },
    GAZP: {
      symbol: 'GAZP',
      name: 'Газпром',
      type: 'STOCK',
      currency: 'RUB',
      exchange: 'MOEX',
    },
    YNDX: {
      symbol: 'YNDX',
      name: 'Яндекс',
      type: 'STOCK',
      currency: 'RUB',
      exchange: 'MOEX',
    },
    BTC: {
      symbol: 'BTC',
      name: 'Bitcoin',
      type: 'CRYPTO',
      currency: 'USD',
      exchange: null,
    },
    ETH: {
      symbol: 'ETH',
      name: 'Ethereum',
      type: 'CRYPTO',
      currency: 'USD',
      exchange: null,
    },
    SPY: {
      symbol: 'SPY',
      name: 'SPDR S&P 500 ETF Trust',
      type: 'ETF',
      currency: 'USD',
      exchange: 'NYSE',
    },
    QQQ: {
      symbol: 'QQQ',
      name: 'Invesco QQQ Trust',
      type: 'ETF',
      currency: 'USD',
      exchange: 'NASDAQ',
    },
  };

  async getCurrentPrice(symbol: string, exchange?: string | null): Promise<number | null> {
    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 10));

    const upperSymbol = symbol.toUpperCase();
    return this.mockPrices[upperSymbol] ?? null;
  }

  async getCurrentPricesBatch(
    symbols: Array<{ symbol: string; exchange?: string | null }>,
  ): Promise<Map<string, number>> {
    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 20));

    const result = new Map<string, number>();
    for (const { symbol } of symbols) {
      const upperSymbol = symbol.toUpperCase();
      const price = this.mockPrices[upperSymbol];
      if (price !== undefined) {
        result.set(upperSymbol, price);
      }
    }
    return result;
  }

  async searchAssets(
    query: string,
    assetType?: 'STOCK' | 'BOND' | 'ETF' | 'FUTURES' | 'CRYPTO' | 'OTHER' | null,
  ): Promise<AssetSearchResult[]> {
    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 50));

    const upperQuery = query.toUpperCase().trim();
    const results: AssetSearchResult[] = [];

    // Search by symbol (exact match first)
    for (const [symbol, asset] of Object.entries(this.mockAssets)) {
      if (assetType && asset.type !== assetType) {
        continue;
      }

      if (symbol === upperQuery || symbol.startsWith(upperQuery)) {
        results.push(asset);
      } else if (asset.name.toUpperCase().includes(upperQuery)) {
        results.push(asset);
      }
    }

    // Sort: exact symbol match first, then by symbol, then by name
    return results.sort((a, b) => {
      const aExact = a.symbol === upperQuery ? 0 : 1;
      const bExact = b.symbol === upperQuery ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;

      if (a.symbol < b.symbol) return -1;
      if (a.symbol > b.symbol) return 1;
      return a.name.localeCompare(b.name);
    });
  }
}
