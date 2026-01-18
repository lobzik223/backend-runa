import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class SetPinDto {
  @IsString()
  @Matches(/^\d{4}$|^\d{6}$/)
  pin!: string;

  @IsOptional()
  @IsInt()
  pinLength?: 4 | 6;

  @IsOptional()
  @IsBoolean()
  biometricEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reauthPassword?: string;
}

