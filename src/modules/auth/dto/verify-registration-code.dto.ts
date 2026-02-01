import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

export class VerifyRegistrationCodeDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Length(6, 6, { message: 'Код должен быть 6 цифр' })
  code!: string;
}
