import { IsOptional, IsString } from 'class-validator';

export class BackfillDto {
  // Source chainId; omit to backfill every chain.
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() target?: string;

  // ISO date/datetime. `from` required; `to` defaults to now.
  @IsString() from!: string;
  @IsOptional() @IsString() to?: string;
}
