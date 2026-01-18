import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class ResetPinDto {
  @IsString()
  @Matches(/^\d{4}$|^\d{6}$/)
  newPin!: string;

  @IsOptional()
  @IsInt()
  pinLength?: 4 | 6;

  @IsOptional()
  @IsBoolean()
  biometricEnabled?: boolean;

  /**
   * Re-auth option A (email accounts): provide current password
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;

  /**
   * Re-auth option B (phone accounts): request OTP via /auth/otp/request and provide code here
   */
  @IsOptional()
  @IsString()
  @MaxLength(8)
  otpCode?: string;
}

