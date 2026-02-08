import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { AppleLoginDto } from './dto/apple-login.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { LoginDto } from './dto/login.dto';
import { OtpRequestDto } from './dto/otp-request.dto';
import { OtpVerifyDto } from './dto/otp-verify.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { ConfirmAccountDeletionDto } from './dto/confirm-account-deletion.dto';
import { RequestAccountDeletionDto } from './dto/request-account-deletion.dto';
import { ConfirmRestoreAccountDto } from './dto/confirm-restore-account.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { RequestRegistrationCodeDto } from './dto/request-registration-code.dto';
import { RequestRestoreAccountDto } from './dto/request-restore-account.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { VerifyRegistrationCodeDto } from './dto/verify-registration-code.dto';
import { ApplyReferralDto } from './dto/apply-referral.dto';
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

  @Post('request-registration-code')
  @Throttle({ default: { limit: 5, ttl: 60 } })
  requestRegistrationCode(@Body() dto: RequestRegistrationCodeDto, @Req() req: Request) {
    return this.auth.requestRegistrationCode({
      name: dto.name,
      email: dto.email,
      password: dto.password,
      referralCode: dto.referralCode,
      deviceId: (req as any).headers?.['x-device-id'],
      ip: req.ip,
    });
  }

  @Post('verify-registration-code')
  @Throttle({ default: { limit: 10, ttl: 60 } })
  verifyRegistrationCode(@Body() dto: VerifyRegistrationCodeDto, @Req() req: Request) {
    return this.auth.verifyRegistrationCode({
      email: dto.email,
      code: dto.code,
      deviceId: (req as any).headers?.['x-device-id'],
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('request-password-reset')
  @Throttle({ default: { limit: 5, ttl: 60 } })
  requestPasswordReset(@Body() dto: RequestPasswordResetDto, @Req() req: Request) {
    return this.auth.requestPasswordReset({
      email: dto.email,
      ip: req.ip,
    });
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 10, ttl: 60 } })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword({
      email: dto.email,
      code: dto.code,
      newPassword: dto.newPassword,
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

  @Post('apple')
  @Throttle({ default: { limit: 10, ttl: 60 } })
  loginWithApple(@Body() dto: AppleLoginDto, @Req() req: Request) {
    return this.auth.loginWithApple({
      identityToken: dto.identityToken,
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

  @Post('apply-referral')
  @UseGuards(JwtAccessGuard)
  @Throttle({ default: { limit: 5, ttl: 60 } })
  applyReferral(
    @Req() req: Request & { user: JwtAccessPayload },
    @Body() dto: ApplyReferralDto,
  ) {
    return this.auth.applyReferralForCurrentUser({
      userId: req.user.sub,
      referralCode: dto.referralCode,
      deviceId: (req as any).headers?.['x-device-id'],
      ip: req.ip,
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

  @Post('request-account-deletion')
  @UseGuards(JwtAccessGuard)
  @Throttle({ default: { limit: 3, ttl: 60 } })
  requestAccountDeletion(
    @Req() req: Request & { user: JwtAccessPayload },
    @Body() dto?: RequestAccountDeletionDto,
  ) {
    return this.auth.requestAccountDeletion(req.user.sub, dto?.locale);
  }

  @Post('confirm-account-deletion')
  @UseGuards(JwtAccessGuard)
  @Throttle({ default: { limit: 10, ttl: 60 } })
  confirmAccountDeletion(
    @Req() req: Request & { user: JwtAccessPayload },
    @Body() dto: ConfirmAccountDeletionDto,
  ) {
    return this.auth.confirmAccountDeletion(req.user.sub, dto.code);
  }

  @Post('request-restore-account')
  @Throttle({ default: { limit: 5, ttl: 60 } })
  requestRestoreAccount(@Body() dto: RequestRestoreAccountDto) {
    return this.auth.requestRestoreAccount({ email: dto.email, locale: dto.locale });
  }

  @Post('confirm-restore-account')
  @Throttle({ default: { limit: 10, ttl: 60 } })
  confirmRestoreAccount(@Body() dto: ConfirmRestoreAccountDto) {
    return this.auth.confirmRestoreAccount({ email: dto.email, code: dto.code });
  }
}

