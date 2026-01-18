import { Module } from '@nestjs/common';
import { DepositAccountsService } from './deposit-accounts.service';
import { DepositAccountsController } from './deposit-accounts.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ScheduledEventsModule } from '../scheduled-events/scheduled-events.module';

@Module({
  imports: [PrismaModule, ScheduledEventsModule],
  controllers: [DepositAccountsController],
  providers: [DepositAccountsService],
  exports: [DepositAccountsService],
})
export class DepositAccountsModule {}
