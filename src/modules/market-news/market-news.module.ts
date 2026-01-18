import { Module } from '@nestjs/common';
import { MarketNewsService } from './market-news.service';
import { MarketNewsController } from './market-news.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MarketNewsController],
  providers: [MarketNewsService],
  exports: [MarketNewsService],
})
export class MarketNewsModule {}
