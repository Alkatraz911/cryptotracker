import { IsString, Length } from 'class-validator';

export class LogUsageDto {
  // Module label for a client-only feature (e.g. "Импорт CSV", "Слияние").
  @IsString()
  @Length(1, 64)
  module!: string;
}
