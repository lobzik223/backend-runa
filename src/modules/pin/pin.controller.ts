import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import type { JwtAccessPayload } from '../auth/types/jwt-payload';
import { ResetPinDto } from './dto/reset-pin.dto';
import { SetPinDto } from './dto/set-pin.dto';
import { VerifyPinDto } from './dto/verify-pin.dto';
import { PinService } from './pin.service';

@Controller('pin')
@UseGuards(JwtAccessGuard)
export class PinController {
  constructor(private readonly pin: PinService) {}

  @Get('status')
  status(@Req() req: Request & { user: JwtAccessPayload }) {
    return this.pin.status(req.user.sub);
  }

  @Get('reauth-method')
  getReauthMethod(@Req() req: Request & { user: JwtAccessPayload }) {
    return this.pin.getReauthMethod(req.user.sub);
  }

  @Post('set')
  set(@Req() req: Request & { user: JwtAccessPayload }, @Body() dto: SetPinDto) {
    return this.pin.setPin(req.user.sub, dto);
  }

  @Post('verify')
  verify(@Req() req: Request & { user: JwtAccessPayload }, @Body() dto: VerifyPinDto) {
    return this.pin.verifyPin(req.user.sub, dto.pin);
  }

  @Post('reset')
  reset(@Req() req: Request & { user: JwtAccessPayload }, @Body() dto: ResetPinDto) {
    return this.pin.resetPin(req.user.sub, dto);
  }
}

