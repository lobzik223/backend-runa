import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Query,
} from '@nestjs/common';
import { InvestmentsService } from './investments.service';
import { AddAssetDto } from './dto/add-asset.dto';
import { AddLotDto } from './dto/add-lot.dto';
import { GetCandlesDto, CandleInterval } from './dto/get-candles.dto';
import { SearchAssetsDto } from './dto/search-assets.dto';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAccessPayload } from '../auth/types/jwt-payload';

@Controller('investments')
@UseGuards(JwtAccessGuard)
export class InvestmentsController {
  constructor(private readonly investmentsService: InvestmentsService) {}

  /**
   * Add an investment asset by ticker or name
   * POST /api/investments/assets
   */
  @Post('assets')
  addAsset(@CurrentUser() user: JwtAccessPayload, @Body() dto: AddAssetDto) {
    return this.investmentsService.addAsset(user.sub, dto);
  }

  /**
   * List all assets for the user
   * GET /api/investments/assets
   */
  @Get('assets')
  listAssets(@CurrentUser() user: JwtAccessPayload) {
    return this.investmentsService.listAssets(user.sub);
  }

  /**
   * Search assets via market data provider (Tinkoff, MOEX, etc.)
   * GET /api/investments/search?query=sber&type=STOCK
   */
  @Get('search')
  searchAssets(@CurrentUser() user: JwtAccessPayload, @Query() dto: SearchAssetsDto) {
    return this.investmentsService.searchAssets(user.sub, dto.query, dto.assetType);
  }

  /**
   * Get asset by ID
   * GET /api/investments/assets/:id
   */
  @Get('assets/:id')
  getAsset(@CurrentUser() user: JwtAccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.investmentsService.getAsset(user.sub, id);
  }

  /**
   * Delete asset (only if no lots exist)
   * DELETE /api/investments/assets/:id
   */
  @Delete('assets/:id')
  deleteAsset(@CurrentUser() user: JwtAccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.investmentsService.deleteAsset(user.sub, id);
  }

  /**
   * Add a lot (purchase) for an asset
   * POST /api/investments/lots
   */
  @Post('lots')
  addLot(@CurrentUser() user: JwtAccessPayload, @Body() dto: AddLotDto) {
    return this.investmentsService.addLot(user.sub, dto);
  }

  /**
   * Get portfolio with computed metrics
   * GET /api/investments/portfolio
   */
  @Get('portfolio')
  getPortfolio(@CurrentUser() user: JwtAccessPayload) {
    return this.investmentsService.getPortfolio(user.sub);
  }

  /**
   * Get historical candles (price data) for an asset
   * GET /api/investments/candles?ticker=SBER&from=2026-01-01&to=2026-01-26&interval=DAY
   */
  @Get('candles')
  getCandles(
    @CurrentUser() user: JwtAccessPayload,
    @Query('ticker') ticker: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('interval') interval?: CandleInterval,
  ) {
    if (!ticker || !from || !to) {
      throw new Error('ticker, from, and to are required');
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);
    const intervalValue = interval || CandleInterval.DAY;

    return this.investmentsService.getCandles(
      user.sub,
      ticker,
      fromDate,
      toDate,
      intervalValue,
    );
  }

  /**
   * Get current quote for an asset
   * GET /api/investments/quotes/:ticker
   */
  @Get('quotes/:ticker')
  getQuote(@CurrentUser() user: JwtAccessPayload, @Param('ticker') ticker: string) {
    return this.investmentsService.getQuote(user.sub, ticker);
  }

  /**
   * Get popular/trending assets with current prices
   * GET /api/investments/popular?category=popular|falling|rising|dividend
   */
  @Get('popular')
  getPopularAssets(
    @CurrentUser() user: JwtAccessPayload,
    @Query('category') category?: 'popular' | 'falling' | 'rising' | 'dividend',
  ) {
    return this.investmentsService.getPopularAssets(user.sub, category || 'popular');
  }
}
