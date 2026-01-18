import { Module } from '@nestjs/common';
import { InvestmentsService } from './investments.service';
import { InvestmentsController } from './investments.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { MockMarketDataProvider } from './providers/mock-market-data.provider';
import { CachedMarketDataProvider } from './providers/cached-market-data.provider';
import { MoexMarketDataProvider } from './providers/moex-market-data.provider';

@Module({
  imports: [PrismaModule],
  controllers: [InvestmentsController],
  providers: [
    InvestmentsService,
    MockMarketDataProvider,
    MoexMarketDataProvider,
    {
      provide: 'MarketDataProvider',
      useFactory: (moex: MoexMarketDataProvider, mockProvider: MockMarketDataProvider) => {
        // Prefer MOEX for RF tickers; fallback to mock if MOEX is down.
        // Cached wrapper expects MarketDataProvider interface.
        return new CachedMarketDataProvider(moex);
      },
      inject: [MoexMarketDataProvider, MockMarketDataProvider],
    },
    // In production, replace with:
    // {
    //   provide: 'MarketDataProvider',
    //   useFactory: (realProvider: YahooFinanceProvider) => {
    //     return new CachedMarketDataProvider(realProvider);
    //   },
    //   inject: [YahooFinanceProvider],
    // },
  ],
  exports: [InvestmentsService],
})
export class InvestmentsModule {}
