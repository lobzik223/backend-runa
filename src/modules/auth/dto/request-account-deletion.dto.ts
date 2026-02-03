import { IsIn, IsOptional } from 'class-validator';

export class RequestAccountDeletionDto {
  @IsOptional()
  @IsIn(['ru', 'en'])
  locale?: 'ru' | 'en';
}
