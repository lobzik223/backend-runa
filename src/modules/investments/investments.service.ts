import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MarketDataProvider, type AssetSearchResult } from './interfaces/market-data-provider.interface';
import { AddAssetDto } from './dto/add-asset.dto';
import { AddLotDto } from './dto/add-lot.dto';
import { PortfolioResponseDto, AssetPortfolioMetrics } from './dto/portfolio-response.dto';
import { InvestmentAssetType, TransactionType } from '@prisma/client';
import { SearchAssetType } from './dto/search-assets.dto';
import { getAssetLogoUrl } from './constants/tinkoff-icon-map';

@Injectable()
export class InvestmentsService {
  private readonly logger = new Logger(InvestmentsService.name);

  constructor(
    private prisma: PrismaService,
    @Inject('MarketDataProvider')
    private marketDataProvider: MarketDataProvider,
  ) {}

  /**
   * Add an investment asset by ticker or name.
   * Strategy:
   * 1. If ticker matches exactly -> use it
   * 2. If ticker not found -> search by name
   * 3. If multiple results -> return error asking user to specify
   * 4. If no results -> create asset with provided ticker/name (user-entered)
   */
  async addAsset(userId: number, dto: AddAssetDto) {
    const tickerOrName = dto.tickerOrName.trim();

    // Step 1: Try exact ticker match first
    const exactMatch = await this.marketDataProvider.getCurrentPrice(
      tickerOrName,
      dto.exchange,
    );

    if (exactMatch !== null) {
      // Found exact match, get asset details
      const searchResults = await this.marketDataProvider.searchAssets(tickerOrName, dto.assetType);
      const assetInfo = searchResults.find((a) => a.symbol.toUpperCase() === tickerOrName.toUpperCase());

      if (assetInfo) {
        // Use market data
        return this.createAssetFromMarketData(userId, assetInfo);
      }
    }

    // Step 2: Search by name/ticker
    const searchResults = await this.marketDataProvider.searchAssets(tickerOrName, dto.assetType);

    if (searchResults.length === 0) {
      // Step 3: No results - create user-entered asset
      this.logger.warn(`No market data found for "${tickerOrName}", creating user-entered asset`);
      return this.createUserEnteredAsset(userId, tickerOrName, dto.assetType, dto.exchange);
    }

    if (searchResults.length === 1) {
      // Single match - use it
      const match = searchResults[0];
      if (!match) {
        throw new BadRequestException('Invalid search result');
      }
      return this.createAssetFromMarketData(userId, match);
    }

    // Multiple matches - return error with suggestions
    throw new BadRequestException({
      message: 'Multiple assets found. Please specify more precisely.',
      suggestions: searchResults.slice(0, 10).map((r) => ({
        symbol: r.symbol,
        name: r.name,
        type: r.type,
        exchange: r.exchange,
      })),
    });
  }

  /**
   * Create asset from market data provider result
   */
  private async createAssetFromMarketData(
    userId: number,
    assetInfo: { symbol: string; name: string; type: string; currency: string; exchange?: string | null },
  ) {
    // Check if asset already exists for this user
    const existing = await this.prisma.investmentAsset.findUnique({
      where: {
        userId_symbol: {
          userId,
          symbol: assetInfo.symbol.toUpperCase(),
        },
      },
    });

    if (existing) {
      return existing;
    }

    // Map provider type to Prisma enum
    const assetType = this.mapAssetType(assetInfo.type);

    return this.prisma.investmentAsset.create({
      data: {
        userId,
        symbol: assetInfo.symbol.toUpperCase(),
        name: assetInfo.name,
        assetType,
        currency: assetInfo.currency,
        exchange: assetInfo.exchange || null,
      },
    });
  }

  /**
   * Create user-entered asset (no market data available)
   */
  private async createUserEnteredAsset(
    userId: number,
    tickerOrName: string,
    assetType?: InvestmentAssetType,
    exchange?: string,
  ) {
    // Check if asset already exists
    const existing = await this.prisma.investmentAsset.findUnique({
      where: {
        userId_symbol: {
          userId,
          symbol: tickerOrName.toUpperCase(),
        },
      },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.investmentAsset.create({
      data: {
        userId,
        symbol: tickerOrName.toUpperCase(),
        name: tickerOrName, // Use ticker as name if no market data
        assetType: assetType || 'OTHER',
        currency: 'RUB', // Default currency
        exchange: exchange || null,
      },
    });
  }

  /**
   * Map provider asset type to Prisma enum
   */
  private mapAssetType(type: string): InvestmentAssetType {
    const upper = type.toUpperCase();
    if (upper === 'STOCK') return 'STOCK';
    if (upper === 'BOND') return 'BOND';
    if (upper === 'ETF') return 'ETF';
    if (upper === 'CRYPTO') return 'CRYPTO';
    if (upper === 'FUTURES') return 'OTHER'; // FUTURES not in enum, use OTHER
    return 'OTHER';
  }

  /**
   * Add a lot (purchase) for an asset
   */
  async addLot(userId: number, dto: AddLotDto) {
    // Verify asset exists and belongs to user
    const asset = await this.prisma.investmentAsset.findUnique({
      where: { id: dto.assetId },
    });

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    if (asset.userId !== userId) {
      throw new ForbiddenException('Asset does not belong to user');
    }

    // Validate boughtAt date
    const boughtAt = new Date(dto.boughtAt);
    if (isNaN(boughtAt.getTime())) {
      throw new BadRequestException('Invalid boughtAt date');
    }

    const created = await this.prisma.investmentLot.create({
      data: {
        userId,
        assetId: dto.assetId,
        quantity: dto.quantity,
        pricePerUnit: dto.pricePerUnit,
        fees: dto.fees || 0,
        boughtAt,
      },
    });

    // Avoid BigInt JSON serialization issues
    return {
      id: typeof created.id === 'bigint' ? created.id.toString() : created.id,
      userId: created.userId,
      assetId: created.assetId,
      quantity: Number(created.quantity),
      pricePerUnit: Number(created.pricePerUnit),
      fees: Number(created.fees),
      boughtAt: created.boughtAt.toISOString(),
      soldAt: created.soldAt ? created.soldAt.toISOString() : null,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  /**
   * Get portfolio with computed metrics
   */
  async getPortfolio(userId: number): Promise<PortfolioResponseDto> {
    // Get all assets with their active lots (not sold)
    const assets = await this.prisma.investmentAsset.findMany({
      where: { userId },
      include: {
        lots: {
          where: {
            soldAt: null, // Only active lots
          },
        },
      },
    });

    const assetMetrics: AssetPortfolioMetrics[] = [];

    // Fetch current prices for all assets in batch (more efficient)
    const symbols = assets.map((asset) => ({
      symbol: asset.symbol,
      exchange: asset.exchange,
    }));
    const pricesMap = await this.marketDataProvider.getCurrentPricesBatch(symbols);
    const currentPrices = assets.map((asset) => pricesMap.get(asset.symbol.toUpperCase()) ?? null);

    // Calculate metrics for each asset
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      if (!asset) continue;
      const currentPrice = currentPrices[i] ?? null;

      const metrics = this.calculateAssetMetrics(asset, currentPrice);
      assetMetrics.push(metrics);
    }

    // Calculate aggregated portfolio metrics
    const totalCost = assetMetrics.reduce((sum, m) => sum + m.totalCost, 0);
    const totalCurrentValue = assetMetrics
      .map((m) => m.currentValue)
      .reduce((sum: number, val) => (val !== null ? sum + val : sum), 0);

    const totalPnlValue =
      totalCurrentValue !== null ? totalCurrentValue - totalCost : null;
    const totalPnlPercent =
      totalPnlValue !== null && totalCost > 0 ? (totalPnlValue / totalCost) * 100 : null;

    return {
      assets: assetMetrics,
      totalCost,
      totalCurrentValue: totalCurrentValue > 0 ? totalCurrentValue : null,
      totalPnlValue: totalPnlValue ?? null,
      totalPnlPercent: totalPnlPercent ?? null,
    };
  }

  /**
   * Calculate metrics for a single asset
   */
  private calculateAssetMetrics(
    asset: {
      id: number;
      symbol: string;
      name: string;
      assetType: InvestmentAssetType;
      currency: string;
      exchange: string | null;
      lots: Array<{
        quantity: any; // Decimal from Prisma
        pricePerUnit: any; // Decimal from Prisma
        fees: any; // Decimal from Prisma
      }>;
    },
    currentPrice: number | null,
  ): AssetPortfolioMetrics {
    const lots = asset.lots;

    if (lots.length === 0) {
      // No active lots
      return {
        assetId: asset.id,
        symbol: asset.symbol,
        name: asset.name,
        assetType: asset.assetType,
        currency: asset.currency,
        exchange: asset.exchange,
        totalQuantity: 0,
        averageBuyPrice: 0,
        totalCost: 0,
        currentValue: null,
        pnlValue: null,
        pnlPercent: null,
        logo: getAssetLogoUrl(asset.symbol),
      };
    }

    // Calculate total quantity and weighted average buy price
    let totalQuantity = 0;
    let totalCost = 0;

    for (const lot of lots) {
      const qty = Number(lot.quantity);
      const price = Number(lot.pricePerUnit);
      const fees = Number(lot.fees || 0);

      totalQuantity += qty;
      totalCost += qty * price + fees;
    }

    const averageBuyPrice = totalQuantity > 0 ? totalCost / totalQuantity : 0;

    // Calculate current value
    const currentValue = currentPrice !== null ? totalQuantity * currentPrice : null;

    // Calculate P&L
    const pnlValue = currentValue !== null ? currentValue - totalCost : null;
    const pnlPercent =
      pnlValue !== null && totalCost > 0 ? (pnlValue / totalCost) * 100 : null;

    return {
      assetId: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      assetType: asset.assetType,
      currency: asset.currency,
      exchange: asset.exchange,
      totalQuantity,
      averageBuyPrice,
      totalCost,
      currentValue,
      pnlValue,
      pnlPercent,
      logo: getAssetLogoUrl(asset.symbol),
    };
  }

  /**
   * Search assets via market data provider (used by frontend search UI)
   */
  async searchAssets(userId: number, query: string, assetType?: SearchAssetType) {
    const trimmed = query?.trim() ?? '';
    if (!trimmed) {
      throw new BadRequestException('Query is required');
    }

    const results = await this.marketDataProvider.searchAssets(trimmed, assetType ?? null);
    const uniqueMap = new Map<string, AssetSearchResult & { logo?: string }>();

    for (const item of results) {
      const key = item.symbol?.toUpperCase() || item.name.toLowerCase();
      if (!key) continue;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, { ...item, logo: getAssetLogoUrl(item.symbol) });
      }
    }

    return Array.from(uniqueMap.values()).slice(0, 40);
  }

  /**
   * List all assets for a user
   */
  async listAssets(userId: number) {
    return this.prisma.investmentAsset.findMany({
      where: { userId },
      include: {
        _count: {
          select: {
            lots: {
              where: {
                soldAt: null, // Count only active lots
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Get asset by ID
   */
  async getAsset(userId: number, assetId: number) {
    const asset = await this.prisma.investmentAsset.findUnique({
      where: { id: assetId },
      include: {
        lots: {
          where: {
            soldAt: null,
          },
          orderBy: {
            boughtAt: 'desc',
          },
        },
      },
    });

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    if (asset.userId !== userId) {
      throw new ForbiddenException('Asset does not belong to user');
    }

    return asset;
  }

  /**
   * Delete (sell) asset and all its lots.
   * Credits user balance with current market value (e.g. if price fell, user gets 970, not 1000).
   */
  async deleteAsset(userId: number, assetId: number) {
    const asset = await this.getAsset(userId, assetId);

    let totalQuantity = 0;
    for (const lot of asset.lots) {
      totalQuantity += Number(lot.quantity);
    }

    const currentPrice = await this.marketDataProvider.getCurrentPrice(
      asset.symbol,
      asset.exchange ?? undefined,
    );
    const currentValue =
      currentPrice !== null && totalQuantity > 0 ? totalQuantity * currentPrice : 0;

    await this.prisma.$transaction(async (tx) => {
      if (currentValue > 0) {
        await tx.transaction.create({
          data: {
            userId,
            type: TransactionType.INCOME,
            amount: Math.round(currentValue * 100) / 100,
            currency: 'RUB',
            occurredAt: new Date(),
            note: `Продажа: ${asset.name} (${asset.symbol})`,
          },
        });
      }

      await tx.investmentLot.deleteMany({
        where: { assetId },
      });

      await tx.investmentAsset.delete({
        where: { id: assetId },
      });
    });
  }

  /**
   * Get candles (historical price data) for an asset
   */
  async getCandles(
    userId: number,
    ticker: string,
    from: Date,
    to: Date,
    interval: '1_MIN' | '5_MIN' | '15_MIN' | 'HOUR' | 'DAY' = 'DAY',
  ) {
    try {
      // Get instrument info from market data provider
      const provider = this.marketDataProvider as any;
      
      // Check if provider supports getInstrumentByTicker (TinkoffMarketDataProvider or CachedMarketDataProvider wrapper)
      if (typeof provider.getInstrumentByTicker === 'function') {
        const instrument = await provider.getInstrumentByTicker(ticker);
        if (!instrument) {
          this.logger.warn(`Instrument not found for ticker: ${ticker}, returning empty candles`);
          return [];
        }

        // Check if provider supports getCandles
        if (typeof provider.getCandles === 'function') {
          try {
            const candles = await provider.getCandles(instrument.figi, from, to, interval);
            if (!candles || candles.length === 0) {
              this.logger.warn(`No candles data for ${ticker} from ${from.toISOString()} to ${to.toISOString()}`);
              return [];
            }
            return candles;
          } catch (candleError: any) {
            this.logger.warn(`Error getting candles for ${ticker}: ${candleError?.message || 'Unknown error'}`);
            return [];
          }
        }
      }

      // If we get here, provider doesn't support candles
      this.logger.warn(`Candles not available for ${ticker}: provider doesn't support getCandles method`);
      return [];
    } catch (error: any) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Error getting candles for ${ticker}:`, error);
      throw new BadRequestException(`Failed to get candles: ${error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Get current quote for an asset
   */
  async getQuote(userId: number, ticker: string) {
    // Allow quotes for any ticker (not only user's assets)
    const price = await this.marketDataProvider.getCurrentPrice(ticker, null);
    if (price === null) {
      throw new NotFoundException(`Price not available for ${ticker}`);
    }

    // Try to get asset info from provider
    let name = ticker;
    let currency = 'RUB';
    let exchange: string | null = null;
    try {
      const searchResults = await this.marketDataProvider.searchAssets(ticker, 'STOCK');
      const assetInfo = searchResults.find((a) => a.symbol.toUpperCase() === ticker.toUpperCase());
      if (assetInfo) {
        name = assetInfo.name || ticker;
        currency = assetInfo.currency || 'RUB';
        exchange = assetInfo.exchange || null;
      }
    } catch {
      // ignore
    }

    return {
      ticker: ticker.toUpperCase(),
      name,
      price,
      currency,
      exchange,
      logo: getAssetLogoUrl(ticker),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get popular/trending assets with current prices
   */
  async getPopularAssets(userId: number, category: 'popular' | 'falling' | 'rising' | 'dividend') {
    // Popular Russian stocks tickers
    const popularTickers = ['SBER', 'GAZP', 'LKOH', 'GMKN', 'NVTK', 'YNDX', 'ROSN', 'TATN', 'SNGS', 'SNGSP'];
    const fallingTickers = ['HYDR', 'CHMF', 'PLZL', 'ALRS', 'MAGN'];
    const risingTickers = ['SBERP', 'VTBR', 'AFKS', 'RTKM', 'MOEX'];
    const dividendTickers = ['SBER', 'GAZP', 'LKOH', 'GMKN', 'NVTK'];

    let tickers: string[] = [];
    switch (category) {
      case 'falling':
        tickers = fallingTickers;
        break;
      case 'rising':
        tickers = risingTickers;
        break;
      case 'dividend':
        tickers = dividendTickers;
        break;
      default:
        tickers = popularTickers;
    }

    const results = [];
    const pricesMap = await this.marketDataProvider.getCurrentPricesBatch(
      tickers.map((t) => ({ symbol: t, exchange: 'MOEX' })),
    );

    // Get yesterday's prices for comparison (using candles from yesterday)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const today = new Date();

    for (const ticker of tickers) {
      const currentPrice = pricesMap.get(ticker.toUpperCase());
      if (currentPrice === undefined || currentPrice === null) continue;

      // Search for asset info
      const searchResults = await this.marketDataProvider.searchAssets(ticker, 'STOCK');
      const assetInfo = searchResults.find((a) => a.symbol.toUpperCase() === ticker.toUpperCase());

      if (!assetInfo) continue;

      // Try to get yesterday's price from candles
      let prevPrice = currentPrice * 0.98; // Fallback
      try {
        const tinkoffProvider = this.marketDataProvider as any;
        if (tinkoffProvider.getInstrumentByTicker && tinkoffProvider.getCandles) {
          const instrument = await tinkoffProvider.getInstrumentByTicker(ticker);
          if (instrument) {
            const candles = await tinkoffProvider.getCandles(
              instrument.figi,
              yesterday,
              today,
              'DAY',
            );
            if (candles && candles.length > 0) {
              const lastCandle = candles[candles.length - 1];
              if (lastCandle && lastCandle.close) {
                prevPrice = lastCandle.close;
              }
            }
          }
        }
      } catch (error) {
        this.logger.debug(`Could not get historical price for ${ticker}, using fallback`);
      }

      const change = currentPrice - prevPrice;
      const changePercent = prevPrice > 0 ? (change / prevPrice) * 100 : 0;

      results.push({
        ticker: assetInfo.symbol,
        name: assetInfo.name,
        price: currentPrice,
        change,
        changePercent,
        currency: assetInfo.currency,
        exchange: assetInfo.exchange,
        type: assetInfo.type,
        logo: getAssetLogoUrl(assetInfo.symbol),
      });
    }

    // Sort by change percent based on category
    if (category === 'falling') {
      results.sort((a, b) => a.changePercent - b.changePercent);
    } else if (category === 'rising') {
      results.sort((a, b) => b.changePercent - a.changePercent);
    }

    return results;
  }
}
