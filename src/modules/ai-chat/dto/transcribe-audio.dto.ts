import { IsOptional, IsString, MaxLength, MinLength, IsIn } from 'class-validator';

/** Аудио в base64 (например запись с микрофона) → Whisper */
export class TranscribeAudioDto {
  @IsString()
  @MinLength(80)
  @MaxLength(5_000_000)
  audioBase64!: string;

  @IsOptional()
  @IsIn([
    'audio/m4a',
    'audio/mp4',
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/webm',
    'audio/x-m4a',
  ])
  mimeType?:
    | 'audio/m4a'
    | 'audio/mp4'
    | 'audio/mpeg'
    | 'audio/mp3'
    | 'audio/wav'
    | 'audio/webm'
    | 'audio/x-m4a';
}
