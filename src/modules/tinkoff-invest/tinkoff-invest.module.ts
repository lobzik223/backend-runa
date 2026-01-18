import { Module } from '@nestjs/common';
import { TinkoffInvestController } from './tinkoff-invest.controller';
import { TinkoffInvestService } from './tinkoff-invest.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TinkoffInvestController],
  providers: [TinkoffInvestService],
  exports: [TinkoffInvestService],
})
export class TinkoffInvestModule {}
