import { Module } from '@nestjs/common';
import { DepositAccountsService } from './deposit-accounts.service';
import { DepositAccountsController } from './deposit-accounts.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ScheduledEventsModule } from '../scheduled-events/scheduled-events.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [PrismaModule, ScheduledEventsModule, SubscriptionsModule],
  controllers: [DepositAccountsController],
  providers: [DepositAccountsService],
  exports: [DepositAccountsService],
})
export class DepositAccountsModule {}
