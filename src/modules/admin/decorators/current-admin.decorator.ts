import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AdminJwtPayload } from '../admin-auth.types';

export const CurrentAdmin = createParamDecorator(
  (data: keyof AdminJwtPayload | undefined, ctx: ExecutionContext): AdminJwtPayload | unknown => {
    const request = ctx.switchToHttp().getRequest<{ user: AdminJwtPayload }>();
    const admin = request.user;
    if (data) {
      return admin?.[data];
    }
    return admin;
  },
);
