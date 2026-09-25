import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

const ADDRESS = /^(0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;

export class SetLabelDto {
  @IsString()
  @Matches(ADDRESS, { message: 'address must be a valid EVM / TRON / Solana address' })
  address!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  // 'manual' (typed) or 'okx' (copied from the OKX/OKLink explorer).
  @IsOptional()
  @IsIn(['manual', 'okx'])
  source?: 'manual' | 'okx';
}

export class ImportLabelsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SetLabelDto)
  entries!: SetLabelDto[];
}

export class LookupLabelsDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  addresses!: string[];
}

class OkxTagDto {
  @IsString()
  @Matches(ADDRESS)
  address!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;
}

// What the userscript saw on an OKX transaction page for a claimed task.
export class OkxReportDto {
  @IsString()
  @Matches(ADDRESS)
  address!: string;

  @IsIn(['found', 'none', 'failed'])
  status!: 'found' | 'none' | 'failed';

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OkxTagDto)
  labels!: OkxTagDto[];

  @IsOptional()
  @IsString()
  @MaxLength(250)
  error?: string;
}
