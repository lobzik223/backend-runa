import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class OtpRequestDto {
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/)
  phoneE164!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;
}

