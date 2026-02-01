/**
 * Portfolio metrics for a single asset
 */
export class AssetPortfolioMetrics {
  assetId!: number;
  symbol!: string;
  name!: string;
  assetType!: string;
  currency!: string;
  exchange?: string | null;
  logo?: string;

  // Total quantity across all active lots
  totalQuantity!: number;

  // Average buy price (weighted by quantity)
  averageBuyPrice!: number;

  // Total cost (sum of all lot costs including fees)
  totalCost!: number;

  // Current market value (totalQuantity * currentPrice)
  currentValue!: number | null; // null if price not available

  // Profit/Loss
  pnlValue!: number | null; // currentValue - totalCost, null if currentValue is null
  pnlPercent!: number | null; // (pnlValue / totalCost) * 100, null if pnlValue is null
}

/** Начальный баланс инвестиционного счёта (руб). */
export const INITIAL_INVESTMENT_BALANCE = 100_000;

/**
 * Overall portfolio summary
 */
export class PortfolioResponseDto {
  assets!: AssetPortfolioMetrics[];

  // Aggregated metrics
  totalCost!: number; // Sum of all asset totalCost
  totalCurrentValue!: number | null; // Sum of all asset currentValue
  totalPnlValue!: number | null; // totalCurrentValue - totalCost
  totalPnlPercent!: number | null; // (totalPnlValue / totalCost) * 100

  /** Доступный баланс: начальный + доход от продаж − расходы на покупки (инвестиционные транзакции). */
  availableBalance!: number;
}
