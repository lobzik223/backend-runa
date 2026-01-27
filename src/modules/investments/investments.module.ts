import { Module } from '@nestjs/common';
import { InvestmentsService } from './investments.service';
import { InvestmentsController } from './investments.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { MockMarketDataProvider } from './providers/mock-market-data.provider';
import { CachedMarketDataProvider } from './providers/cached-market-data.provider';
import { MoexMarketDataProvider } from './providers/moex-market-data.provider';
import { TinkoffMarketDataProvider } from './providers/tinkoff-market-data.provider';

@Module({
  imports: [PrismaModule],
  controllers: [InvestmentsController],
  providers: [
    InvestmentsService,
    MockMarketDataProvider,
    MoexMarketDataProvider,
    TinkoffMarketDataProvider,
    {
      provide: 'MarketDataProvider',
      useFactory: (
        tinkoff: TinkoffMarketDataProvider,
        moex: MoexMarketDataProvider,
        mockProvider: MockMarketDataProvider,
      ) => {
        // Prefer Tinkoff if token is configured, otherwise fallback to MOEX, then mock
        const tinkoffToken = process.env.TINKOFF_DEMO_TOKEN || process.env.TINKOFF_TOKEN;
        if (tinkoffToken) {
          return new CachedMarketDataProvider(tinkoff);
        }
        // Fallback to MOEX for RF tickers; fallback to mock if MOEX is down.
        return new CachedMarketDataProvider(moex);
      },
      inject: [TinkoffMarketDataProvider, MoexMarketDataProvider, MockMarketDataProvider],
    },
  ],
  exports: [InvestmentsService],
})
export class InvestmentsModule {}
