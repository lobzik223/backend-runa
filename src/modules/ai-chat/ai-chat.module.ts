import { Module } from '@nestjs/common';
import { AIChatService } from './ai-chat.service';
import { AIChatController } from './ai-chat.controller';
import { FinanceContextService } from './finance-context.service';
import { AIRulesEngineService } from './ai-rules-engine.service';
import { LLMService } from './llm.service';
import { ChartDataService } from './chart-data.service';
import { ProactiveTriggersJob } from './proactive-triggers.job';
import { PrismaModule } from '../prisma/prisma.module';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';

@Module({
  imports: [PrismaModule, PushNotificationsModule],
  controllers: [AIChatController],
  providers: [AIChatService, FinanceContextService, AIRulesEngineService, LLMService, ChartDataService, ProactiveTriggersJob],
  exports: [AIChatService, ChartDataService],
})
export class AIChatModule {}
