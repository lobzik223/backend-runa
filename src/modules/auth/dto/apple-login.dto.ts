import { IsNotEmpty, IsString } from 'class-validator';

export class AppleLoginDto {
  @IsString()
  @IsNotEmpty()
  identityToken!: string;
}
