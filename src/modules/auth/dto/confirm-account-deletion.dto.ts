import { IsString, Length } from 'class-validator';

export class ConfirmAccountDeletionDto {
  @IsString()
  @Length(6, 6, { message: 'Код должен быть 6 цифр' })
  code!: string;
}
