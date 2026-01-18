/**
 * Market data provider interface for fetching current prices of investment assets.
 * This abstraction allows switching between different data sources (Yahoo Finance, Alpha Vantage, etc.)
 * without changing the business logic.
 */
export interface MarketDataProvider {
  /**
   * Get current price for an asset by symbol/ticker
   * @param symbol Asset ticker/symbol (e.g., "AAPL", "SBER")
   * @param exchange Optional exchange code (e.g., "NASDAQ", "MOEX")
   * @returns Current price in the asset's currency, or null if not found
   */
  getCurrentPrice(symbol: string, exchange?: string | null): Promise<number | null>;

  /**
   * Get current prices for multiple assets by ticker list (batch request)
   * More efficient than multiple getCurrentPrice calls
   * @param symbols Array of {symbol, exchange} pairs
   * @returns Map of symbol -> price (missing tickers are not included in result)
   */
  getCurrentPricesBatch(
    symbols: Array<{ symbol: string; exchange?: string | null }>,
  ): Promise<Map<string, number>>;

  /**
   * Search for assets by ticker or name
   * @param query Search query (ticker or name)
   * @param assetType Optional filter by asset type
   * @returns Array of matching assets with symbol, name, type, currency, exchange
   */
  searchAssets(
    query: string,
    assetType?: 'STOCK' | 'BOND' | 'ETF' | 'FUTURES' | 'CRYPTO' | 'OTHER' | null,
  ): Promise<AssetSearchResult[]>;
}

/**
 * Result of asset search
 */
export interface AssetSearchResult {
  symbol: string;
  name: string;
  type: 'STOCK' | 'BOND' | 'ETF' | 'FUTURES' | 'CRYPTO' | 'OTHER';
  currency: string;
  exchange?: string | null;
}
