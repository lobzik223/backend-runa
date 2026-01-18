import { Module } from '@nestjs/common';
import { PushNotificationsService } from './push-notifications.service';
import { PushNotificationsController } from './push-notifications.controller';
import { ScheduledEventsNotificationJob } from './scheduled-events-notification.job';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PushNotificationsController],
  providers: [PushNotificationsService, ScheduledEventsNotificationJob],
  exports: [PushNotificationsService],
})
export class PushNotificationsModule {}
