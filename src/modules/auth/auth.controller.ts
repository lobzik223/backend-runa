import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { GoogleLoginDto } from './dto/google-login.dto';
import { LoginDto } from './dto/login.dto';
import { OtpRequestDto } from './dto/otp-request.dto';
import { OtpVerifyDto } from './dto/otp-verify.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAccessGuard } from './guards/jwt-access.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import type { JwtAccessPayload, JwtRefreshPayload } from './types/jwt-payload';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60 } })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    const cleanDto: any = {
      name: dto.name,
      email: dto.email,
      password: dto.password,
    };
    if (dto.referralCode != null && String(dto.referralCode).trim()) {
      cleanDto.referralCode = String(dto.referralCode).trim();
    }
    return this.auth.register({
      ...cleanDto,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60 } })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login({
      ...dto,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('google')
  @Throttle({ default: { limit: 10, ttl: 60 } })
  loginWithGoogle(@Body() dto: GoogleLoginDto, @Req() req: Request) {
    return this.auth.loginWithGoogle({
      idToken: dto.idToken,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('otp/request')
  @Throttle({ default: { limit: 5, ttl: 60 } })
  requestOtp(@Body() dto: OtpRequestDto, @Req() req: Request) {
    return this.auth.requestOtp({
      ...dto,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('otp/verify')
  @Throttle({ default: { limit: 10, ttl: 60 } })
  verifyOtp(@Body() dto: OtpVerifyDto, @Req() req: Request) {
    return this.auth.verifyOtp({
      ...dto,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('me')
  @UseGuards(JwtAccessGuard)
  @SkipThrottle()
  me(@Req() req: Request & { user: JwtAccessPayload }) {
    return this.auth.me(req.user.sub);
  }

  @Patch('me')
  @UseGuards(JwtAccessGuard)
  updateProfile(
    @Req() req: Request & { user: JwtAccessPayload },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.auth.updateProfile(req.user.sub, dto);
  }

  @Post('refresh')
  @UseGuards(JwtRefreshGuard)
  @SkipThrottle()
  refresh(@Body() _dto: RefreshDto, @Req() req: Request & { user: JwtRefreshPayload }) {
    return this.auth.refresh(req.user.sub, req.user.jti, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('logout')
  @UseGuards(JwtRefreshGuard)
  @SkipThrottle()
  logout(@Body() _dto: RefreshDto, @Req() req: Request & { user: JwtRefreshPayload }) {
    return this.auth.logout(req.user.sub, req.user.jti);
  }
}

