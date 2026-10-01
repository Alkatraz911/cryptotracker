import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { TokenStatus } from '../entities/token-contract.entity';

export class SetTokenDto {
  @IsIn(['SOLANA', 'ETH', 'BSC', 'POLYGON', 'ARBITRUM', 'BASE', 'TRON'])
  network!: string;

  @IsString()
  @Matches(/^(0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33}|[1-9A-HJ-NP-Za-km-z]{32,44})$/)
  contract!: string;

  @IsIn(['trusted', 'scam', 'unknown'])
  status!: TokenStatus;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  reason?: string;
}

export class ImportTokensDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SetTokenDto)
  entries!: SetTokenDto[];
}
