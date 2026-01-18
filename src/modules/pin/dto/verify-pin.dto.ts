import { IsString, Matches } from 'class-validator';

export class VerifyPinDto {
  @IsString()
  @Matches(/^\d{4}$|^\d{6}$/)
  pin!: string;
}

