import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RequestRegistrationCodeDto {
  @IsString()
  @MaxLength(15)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  referralCode?: string;
}
