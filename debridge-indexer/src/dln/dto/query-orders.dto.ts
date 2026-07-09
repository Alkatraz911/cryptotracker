import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryOrdersDto {
  @IsOptional() @IsString() give?: string;   // give chainId
  @IsOptional() @IsString() take?: string;   // take chainId
  @IsOptional() @IsString() from?: string;   // ISO date/datetime
  @IsOptional() @IsString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) limit?: number;
}
