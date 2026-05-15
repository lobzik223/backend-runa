import { IsOptional, IsString, MaxLength, MinLength, IsIn } from 'class-validator';

export class ChatMessageDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message?: string;

  /** Base64 изображения (без префикса data: или с префиксом). JPEG/PNG/WebP. Для анализа нужен OPENAI_API_KEY на сервере. */
  @IsOptional()
  @IsString()
  @MaxLength(7_800_000)
  imageBase64?: string;

  @IsOptional()
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  imageMimeType?: 'image/jpeg' | 'image/png' | 'image/webp';

  @IsString()
  @IsOptional()
  threadId?: string;

  @IsOptional()
  @IsIn(['ru', 'en'])
  preferredLanguage?: 'ru' | 'en';
}
