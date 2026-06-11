// Network registry + explorer link builders + parsing existing links.
// Networks required on day one: TRON, BSC, ARBITRUM, BASE, POLYGON, ETH.

export type Network =
  | "ETH"
  | "BSC"
  | "POLYGON"
  | "ARBITRUM"
  | "BASE"
  | "TRON"
  | "SOLANA"
  | "UNKNOWN";

interface ExplorerDef {
  name: string;
  host: string; // canonical explorer domain
  addr: (a: string) => string;
  tx: (h: string) => string;
  color: string;
}

export const EXPLORERS: Record<Exclude<Network, "UNKNOWN">, ExplorerDef> = {
  ETH: {
    name: "Etherscan",
    host: "etherscan.io",
    addr: (a) => `https://etherscan.io/address/${a}`,
    tx: (h) => `https://etherscan.io/tx/${h}`,
    color: "#627eea",
  },
  BSC: {
    name: "BscScan",
    host: "bscscan.com",
    addr: (a) => `https://bscscan.com/address/${a}`,
    tx: (h) => `https://bscscan.com/tx/${h}`,
    color: "#f0b90b",
  },
  POLYGON: {
    name: "PolygonScan",
    host: "polygonscan.com",
    addr: (a) => `https://polygonscan.com/address/${a}`,
    tx: (h) => `https://polygonscan.com/tx/${h}`,
    color: "#8247e5",
  },
  ARBITRUM: {
    name: "Arbiscan",
    host: "arbiscan.io",
    addr: (a) => `https://arbiscan.io/address/${a}`,
    tx: (h) => `https://arbiscan.io/tx/${h}`,
    color: "#28a0f0",
  },
  BASE: {
    name: "BaseScan",
    host: "basescan.org",
    addr: (a) => `https://basescan.org/address/${a}`,
    tx: (h) => `https://basescan.org/tx/${h}`,
    color: "#0052ff",
  },
  TRON: {
    name: "Tronscan",
    host: "tronscan.org",
    addr: (a) => `https://tronscan.org/#/address/${a}`,
    tx: (h) => `https://tronscan.org/#/transaction/${h}`,
    color: "#ff060a",
  },
  SOLANA: {
    name: "Solscan",
    host: "solscan.io",
    addr: (a) => `https://solscan.io/account/${a}`,
    tx: (h) => `https://solscan.io/tx/${h}`,
    color: "#9945ff",
  },
};

export const ALL_NETWORKS: Network[] = [
  "TRON",
  "SOLANA",
  "BSC",
  "ARBITRUM",
  "BASE",
  "POLYGON",
  "ETH",
];

// Map many exchange/explorer spellings to our canonical network code.
const NETWORK_ALIASES: Record<string, Network> = {
  // TRON
  trx: "TRON", tron: "TRON", trc20: "TRON", trc: "TRON", "tron (trc20)": "TRON",
  // Ethereum
  eth: "ETH", ethereum: "ETH", erc20: "ETH", "eth (erc20)": "ETH", mainnet: "ETH",
  // BNB
  bsc: "BSC", bnb: "BSC", bep20: "BSC", "bnb smart chain": "BSC",
  "binance smart chain": "BSC", "bsc (bep20)": "BSC", bnbchain: "BSC",
  // Arbitrum
  arb: "ARBITRUM", arbitrum: "ARBITRUM", "arbitrum one": "ARBITRUM", arbitrumone: "ARBITRUM",
  // Base
  base: "BASE",
  // Polygon
  polygon: "POLYGON", matic: "POLYGON", pol: "POLYGON", "polygon pos": "POLYGON",
  // Solana
  sol: "SOLANA", solana: "SOLANA", "solana (sol)": "SOLANA",
};

export function normalizeNetwork(raw: unknown): Network {
  if (!raw) return "UNKNOWN";
  const k = String(raw).trim().toLowerCase();
  if (NETWORK_ALIASES[k]) return NETWORK_ALIASES[k];
  const upper = k.toUpperCase();
  return upper in EXPLORERS ? (upper as Network) : "UNKNOWN";
}

// Infer the network from a tx/address explorer URL by its domain.
export function networkFromUrl(url: string): Network {
  const u = url.toLowerCase();
  for (const [net, def] of Object.entries(EXPLORERS)) {
    if (u.includes(def.host)) return net as Network;
  }
  return "UNKNOWN";
}

// Pull a tx hash out of an explorer URL (handles /tx/, /transaction/, query).
export function hashFromUrl(url: string): string | null {
  const m = url.match(/(?:tx|transaction)[/=]([0-9a-zA-Z]+)/);
  if (m) return m[1];
  // tronscan style: /#/transaction/HASH already covered; fallback to last seg
  const seg = url.split(/[/?#=]/).filter(Boolean).pop();
  return seg && seg.length >= 16 ? seg : null;
}

// Guess network from address shape when nothing else is known.
export function networkFromAddress(addr: string): Network {
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) return "TRON";
  if (/^0x[0-9a-fA-F]{40}$/.test(addr)) return "ETH"; // EVM; chain unknown -> default ETH
  // Solana: base58, 32-44 chars (checked after TRON to avoid false positives)
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) return "SOLANA";
  return "UNKNOWN";
}

// Canonical key for de-duplication: lowercase EVM, keep TRON case-sensitive.
export function addrKey(addr: string): string {
  return addr.startsWith("0x") ? addr.toLowerCase() : addr;
}

export function addressUrl(net: Network, addr: string): string | null {
  if (net === "UNKNOWN") return null;
  return EXPLORERS[net].addr(addr);
}

export function txUrl(net: Network, hash: string): string | null {
  if (net === "UNKNOWN") return null;
  return EXPLORERS[net].tx(hash);
}

export function networkColor(net: Network): string {
  return net === "UNKNOWN" ? "#6b7280" : EXPLORERS[net].color;
}

export function addressFromUrl(url: string): string | null {
  // Solscan uses /account/ADDR; other explorers use /address/ADDR
  const m = url.match(/(?:address|account)[/=]([0-9a-zA-Z]+)/);
  return m ? m[1] : null;
}

export interface ExplorerRef {
  kind: "tx" | "address";
  network: Network;
  id: string;
}

// Parse a pasted explorer link into {kind, network, id}.
export function parseExplorerUrl(url: string): ExplorerRef | null {
  const u = url.trim();
  if (!u) return null;
  let network = networkFromUrl(u);
  if (/\/(tx|transaction)[/=]/i.test(u)) {
    const id = hashFromUrl(u);
    if (!id) return null;
    if (network === "UNKNOWN") network = networkFromAddress(id);
    return { kind: "tx", network, id };
  }
  if (/\/(?:address|account)[/=]/i.test(u)) {
    const id = addressFromUrl(u);
    if (!id) return null;
    if (network === "UNKNOWN") network = networkFromAddress(id);
    return { kind: "address", network, id };
  }
  return null;
}
