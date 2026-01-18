import { Module } from '@nestjs/common';
import { CreditAccountsService } from './credit-accounts.service';
import { CreditAccountsController } from './credit-accounts.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ScheduledEventsModule } from '../scheduled-events/scheduled-events.module';

@Module({
  imports: [PrismaModule, ScheduledEventsModule],
  controllers: [CreditAccountsController],
  providers: [CreditAccountsService],
  exports: [CreditAccountsService],
})
export class CreditAccountsModule {}
