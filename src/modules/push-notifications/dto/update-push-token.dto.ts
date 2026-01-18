import { IsString, IsEnum, IsOptional } from 'class-validator';

export enum Platform {
  IOS = 'ios',
  ANDROID = 'android',
  WEB = 'web',
}

export class UpdatePushTokenDto {
  @IsString()
  deviceId!: string;

  @IsString()
  @IsOptional()
  pushToken?: string | null; // null to remove token

  @IsEnum(Platform)
  @IsOptional()
  platform?: Platform;
}
