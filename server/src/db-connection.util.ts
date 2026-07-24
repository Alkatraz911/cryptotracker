// Managed Postgres providers (Supabase, etc.) often ship DATABASE_URL with
// ?sslmode=require. Recent pg-connection-string versions treat 'require' (and
// 'prefer'/'verify-ca') as an alias for 'verify-full' and derive their OWN ssl
// config straight from that query param — which then wins over a separately
// passed `ssl` option and fails with SELF_SIGNED_CERT_IN_CHAIN against a
// pooler whose cert chain isn't in Node's default trust store. Stripping
// sslmode from the URL stops pg-connection-string from deriving that config
// at all, so only the explicit ssl object below governs TLS behavior.
export function splitDatabaseUrl(raw: string): { url: string; ssl: false | { rejectUnauthorized: boolean } } {
  const wantsSsl = raw.includes('sslmode=');
  let url = raw;
  try {
    const u = new URL(raw);
    u.searchParams.delete('sslmode');
    u.searchParams.delete('uselibpqcompat');
    url = u.toString();
  } catch {
    /* leave url as-is if unparsable */
  }
  return { url, ssl: wantsSsl ? { rejectUnauthorized: false } : false };
}
