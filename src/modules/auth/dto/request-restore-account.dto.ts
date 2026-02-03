import { IsEmail, IsIn, IsOptional, MaxLength } from 'class-validator';

export class RequestRestoreAccountDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsIn(['ru', 'en'])
  locale?: 'ru' | 'en';
}
