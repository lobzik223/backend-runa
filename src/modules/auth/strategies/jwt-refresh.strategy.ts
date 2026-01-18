import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { env } from '../../../config/env.validation';
import type { JwtRefreshPayload } from '../types/jwt-payload';

function extractRefreshToken(req: any): string | null {
  const fromBody = req?.body?.refreshToken;
  if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody;

  const authHeader = req?.headers?.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length);
  }

  return null;
}

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor() {
    super({
      jwtFromRequest: extractRefreshToken,
      ignoreExpiration: false,
      secretOrKey: env.JWT_REFRESH_SECRET,
      passReqToCallback: false,
    });
  }

  validate(payload: JwtRefreshPayload) {
    if (payload?.typ !== 'refresh') return null;
    return payload;
  }
}

