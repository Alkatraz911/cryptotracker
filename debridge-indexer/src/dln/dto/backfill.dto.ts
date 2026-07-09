import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class BackfillDto {
  @IsOptional() @IsString() give?: string;   // give chainId filter (network code, e.g. BSC)
  @IsOptional() @IsString() take?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) max?: number;
}
