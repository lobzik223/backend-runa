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
}
