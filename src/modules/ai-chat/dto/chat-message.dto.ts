import { IsString, IsOptional, MinLength, MaxLength, IsIn } from 'class-validator';

export class ChatMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;

  @IsString()
  @IsOptional()
  threadId?: string;

  /** Язык ответа: ru | en. Если не передан — определяется по тексту сообщения. */
  @IsOptional()
  @IsIn(['ru', 'en'])
  preferredLanguage?: 'ru' | 'en';
}
