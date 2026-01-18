import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { PushNotificationsService } from './push-notifications.service';
import { UpdatePushTokenDto } from './dto/update-push-token.dto';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAccessPayload } from '../auth/types/jwt-payload';

@Controller('push-notifications')
@UseGuards(JwtAccessGuard)
export class PushNotificationsController {
  constructor(private readonly pushNotificationsService: PushNotificationsService) {}

  @Post('token')
  updateToken(@CurrentUser() user: JwtAccessPayload, @Body() dto: UpdatePushTokenDto) {
    return this.pushNotificationsService.updatePushToken(user.sub, dto);
  }
}
