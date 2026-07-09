import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryBridgesDto {
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() target?: string;

  @IsOptional() @Type(() => Number) @IsNumber() minUsd?: number;

  // ISO date or datetime, e.g. 2025-11-20 or 2025-11-20T00:00:00Z
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) limit?: number;
}
