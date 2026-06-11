import type { GNode } from "../lib/graph";
import { tagById } from "../lib/tags";

export default function DetailsPanel({ node }: { node: GNode | null }) {
  if (!node) return null;
  const tag = tagById(node.tag);
  return (
    <div className="details">
      <div className="dhead">
        <span className="badge" style={{ background: node.color }}>{node.kind}</span>
        {node.net && node.net !== "UNKNOWN" && <span className="net">{node.net}</span>}
        {tag && <span className="badge" style={{ background: tag.color }}>⚑ {tag.label}</span>}
      </div>

      {node.entityName && <Row k="Entity" v={node.entityName} highlight />}
      {node.note && <Row k="Метка" v={node.note} />}

      {node.address && <Row k="Address" v={node.address} mono />}
      {node.uid && <Row k="UID" v={node.uid} />}
      {node.exchange && <Row k="Exchange" v={node.exchange} />}
      {node.hash && <Row k="Tx" v={node.hash} mono />}
      {node.amount != null && <Row k="Amount" v={`${node.amount} ${node.coin ?? ""}`} />}
      {node.ip && <Row k="IP" v={node.ip} mono />}
      <Row k="Connections" v={String(node.degree)} />

      {node.explorerUrl && (
        <a className="explorerbtn" href={node.explorerUrl} target="_blank" rel="noopener">
          Open in explorer ↗
        </a>
      )}
    </div>
  );
}

function Row({ k, v, mono, highlight }: { k: string; v: string; mono?: boolean; highlight?: boolean }) {
  return (
    <div className="drow">
      <span className="dk">{k}</span>
      <span className={[mono ? "mono" : "", highlight ? "entity-name" : "", "dv"].filter(Boolean).join(" ")}>{v}</span>
    </div>
  );
}
