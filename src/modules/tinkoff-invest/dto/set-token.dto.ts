import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class SetTinkoffTokenDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsBoolean()
  @IsOptional()
  useSandbox?: boolean;
}
