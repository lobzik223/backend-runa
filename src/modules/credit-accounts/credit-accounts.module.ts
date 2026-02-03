import { Module } from '@nestjs/common';
import { CreditAccountsService } from './credit-accounts.service';
import { CreditAccountsController } from './credit-accounts.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ScheduledEventsModule } from '../scheduled-events/scheduled-events.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [PrismaModule, ScheduledEventsModule, SubscriptionsModule],
  controllers: [CreditAccountsController],
  providers: [CreditAccountsService],
  exports: [CreditAccountsService],
})
export class CreditAccountsModule {}
