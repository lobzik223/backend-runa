import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { TinkoffInvestService } from './tinkoff-invest.service';
import { SetTinkoffTokenDto } from './dto/set-token.dto';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAccessPayload } from '../auth/types/jwt-payload';

@Controller('tinkoff-invest')
@UseGuards(JwtAccessGuard)
export class TinkoffInvestController {
  constructor(private readonly tinkoffInvestService: TinkoffInvestService) {}

  /**
   * Установить токен Tinkoff Invest
   * POST /api/tinkoff-invest/token
   */
  @Post('token')
  async setToken(
    @CurrentUser() user: JwtAccessPayload,
    @Body() dto: SetTinkoffTokenDto,
  ) {
    await this.tinkoffInvestService.setTinkoffToken(
      user.sub,
      dto.token,
      dto.useSandbox || false,
    );
    return { message: 'Token saved successfully' };
  }

  /**
   * Удалить токен Tinkoff Invest
   * DELETE /api/tinkoff-invest/token
   */
  @Delete('token')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeToken(@CurrentUser() user: JwtAccessPayload) {
    await this.tinkoffInvestService.removeTinkoffToken(user.sub);
  }

  /**
   * Получить портфель из Tinkoff Invest
   * GET /api/tinkoff-invest/portfolio
   */
  @Get('portfolio')
  async getPortfolio(@CurrentUser() user: JwtAccessPayload) {
    return this.tinkoffInvestService.getPortfolio(user.sub);
  }

  /**
   * Создать демо-аккаунт в песочнице
   * POST /api/tinkoff-invest/demo/create
   */
  @Post('demo/create')
  async createDemoAccount(@CurrentUser() user: JwtAccessPayload) {
    return this.tinkoffInvestService.createDemoAccount();
  }

  /**
   * Получить список аккаунтов Tinkoff
   * GET /api/tinkoff-invest/accounts
   */
  @Get('accounts')
  async getAccounts(@CurrentUser() user: JwtAccessPayload) {
    return this.tinkoffInvestService.getAccounts(user.sub);
  }

  /**
   * Поиск инструментов в Tinkoff
   * GET /api/tinkoff-invest/search?query=SBER
   */
  @Get('search')
  async searchInstruments(
    @CurrentUser() user: JwtAccessPayload,
    @Query('query') query: string,
  ) {
    if (!query || query.trim().length === 0) {
      throw new BadRequestException('Query parameter is required');
    }
    return this.tinkoffInvestService.searchInstruments(user.sub, query);
  }

  /**
   * Синхронизировать портфель из Tinkoff в локальную БД
   * POST /api/tinkoff-invest/sync
   */
  @Post('sync')
  async syncPortfolio(@CurrentUser() user: JwtAccessPayload) {
    return this.tinkoffInvestService.syncPortfolio(user.sub);
  }

  /**
   * Получить текущую цену инструмента
   * GET /api/tinkoff-invest/price?figi=BBG004730N88
   */
  @Get('price')
  async getCurrentPrice(
    @CurrentUser() user: JwtAccessPayload,
    @Query('figi') figi: string,
  ) {
    if (!figi || figi.trim().length === 0) {
      throw new BadRequestException('FIGI parameter is required');
    }
    return this.tinkoffInvestService.getCurrentPrice(figi);
  }
}
