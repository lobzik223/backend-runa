import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { PinModule } from './modules/pin/pin.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { CreditAccountsModule } from './modules/credit-accounts/credit-accounts.module';
import { DepositAccountsModule } from './modules/deposit-accounts/deposit-accounts.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { PaymentMethodsModule } from './modules/payment-methods/payment-methods.module';
import { PushNotificationsModule } from './modules/push-notifications/push-notifications.module';
import { InvestmentsModule } from './modules/investments/investments.module';
import { MarketNewsModule } from './modules/market-news/market-news.module';
import { AIChatModule } from './modules/ai-chat/ai-chat.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { GoalsModule } from './modules/goals/goals.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { DataRetentionModule } from './modules/data-retention/data-retention.module';
import { env } from './config/env.validation';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        // Throttler TTL is in seconds
        ttl: env.THROTTLE_TTL_SECONDS,
        limit: env.THROTTLE_LIMIT,
      },
    ]),
    PrismaModule,
    DataRetentionModule,
    HealthModule,
    AuthModule,
    CategoriesModule,
    PaymentMethodsModule,
    PinModule,
    TransactionsModule,
    CreditAccountsModule,
    DepositAccountsModule,
    PushNotificationsModule,
    InvestmentsModule,
    MarketNewsModule,
    AIChatModule,
    SubscriptionsModule,
    PaymentsModule,
    GoalsModule,
  ],
})
export class AppModule {}

