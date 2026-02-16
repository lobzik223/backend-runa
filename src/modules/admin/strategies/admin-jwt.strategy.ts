import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { env } from '../../../config/env.validation';
import type { AdminJwtPayload } from '../admin-auth.types';

@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: env.JWT_ADMIN_SECRET,
    });
  }

  async validate(payload: unknown): Promise<AdminJwtPayload> {
    const p = payload as Record<string, unknown>;
    if (p?.typ !== 'admin' || typeof p?.sub !== 'number' || typeof p?.email !== 'string') {
      throw new UnauthorizedException('Недействительный токен админа');
    }
    return {
      sub: p.sub as number,
      email: p.email as string,
      role: p.role as 'SUPER_ADMIN',
      typ: 'admin',
    };
  }
}
