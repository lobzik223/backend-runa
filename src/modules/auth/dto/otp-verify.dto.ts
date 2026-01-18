import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class OtpVerifyDto {
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/)
  phoneE164!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(8)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  referralCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;
}

