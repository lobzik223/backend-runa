import { IsString, IsOptional, IsIn } from 'class-validator';

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

  /** ios | android | web — принимаем строку от клиента (React Native Platform.OS) */
  @IsOptional()
  @IsIn(['ios', 'android', 'web'])
  platform?: string;

  /** Preferred language for push messages: ru | en (from app/device) */
  @IsOptional()
  @IsIn(['ru', 'en'])
  preferredLocale?: 'ru' | 'en';
}
