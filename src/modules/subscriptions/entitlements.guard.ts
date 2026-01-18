import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { EntitlementsService } from './entitlements.service';

/**
 * Guard to check if user has Premium access
 */
@Injectable()
export class PremiumGuard implements CanActivate {
  constructor(private entitlementsService: EntitlementsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const isPremium = await this.entitlementsService.isPremium(user.sub);
    if (!isPremium) {
      throw new ForbiddenException('Premium subscription required');
    }

    return true;
  }
}
