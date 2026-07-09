import { IsString, Matches, MinLength } from 'class-validator';

export class AddBridgeDto {
  // EVM (0x…40) / TRON (T…) / Solana addresses — accept a broad alphanumeric set.
  @IsString()
  @Matches(/^(0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33}|[1-9A-HJ-NP-Za-km-z]{32,44})$/, {
    message: 'address must be a valid EVM / TRON / Solana address',
  })
  address!: string;

  // Bridge id (slug). Adapters resolve cross-chain for matching ids; any other id
  // is detection-only (labelled, no resolve button).
  @Matches(/^[a-z0-9_-]{2,32}$/, { message: 'bridge must be a slug like orbiter / debridge / lifi' })
  bridge!: string;

  @IsString()
  @MinLength(1)
  name!: string;
}
