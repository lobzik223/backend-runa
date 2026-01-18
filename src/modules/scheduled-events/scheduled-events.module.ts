import { Module } from '@nestjs/common';
import { ScheduledEventsService } from './scheduled-events.service';
import { InterestCalculatorService } from './interest-calculator.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [ScheduledEventsService, InterestCalculatorService],
  exports: [ScheduledEventsService, InterestCalculatorService],
})
export class ScheduledEventsModule {}
