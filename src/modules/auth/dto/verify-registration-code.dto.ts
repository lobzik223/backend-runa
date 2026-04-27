import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

function digitsOnlyOtp(value: unknown): string {
  if (value == null) return '';
  return String(value).replace(/\D/g, '');
}

export class VerifyRegistrationCodeDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Transform(({ value }) => digitsOnlyOtp(value))
  @IsString()
  @Length(6, 6, { message: 'Код должен быть 6 цифр' })
  code!: string;
}
