// Manual markers an investigator can put on nodes. Stored on the node, so
// they persist with the saved project.
export interface TagDef {
  id: string;
  label: string;
  color: string;
}

// Marker colours are deliberately distinct from the chain palette (TRON red,
// BSC gold, ETH periwinkle): on the board a chain is the ring, a marker is the
// halo around it, and the two must never be confused for one another.
export const TAGS: TagDef[] = [
  { id: "suspect", label: "Подозрительный", color: "#F26D62" },
  { id: "victim", label: "Жертва", color: "#7FD1E8" },
  { id: "exchange", label: "Биржа", color: "#35B27F" },
  { id: "mixer", label: "Миксер", color: "#9B7BE8" },
  { id: "service", label: "Сервис", color: "#6D8FE8" },
  { id: "cashout", label: "Вывод/обнал", color: "#E87FBF" },
  { id: "owned", label: "Свой/контроль", color: "#2ED3C6" },
];

export const tagById = (id?: string | null): TagDef | undefined =>
  id ? TAGS.find((t) => t.id === id) : undefined;

// Tags that flag a node as high-risk (drives the red risk ring / ⚠ glyph on the
// graph and the risk marker in the side panel).
const RISK_TAGS = new Set(["suspect", "mixer", "cashout"]);
export const isRiskTag = (id?: string | null): boolean => !!id && RISK_TAGS.has(id);

// Heuristic risk from an explorer/entity label (mixers, sanctioned services).
const RISK_NAME = /tornado|mixer|sanction|ofac|lazarus|hydra|garantex|blender|sinbad/i;
export const isRiskName = (name?: string | null): boolean => !!name && RISK_NAME.test(name);

// Whether a node should be shown as risky given its manual tag + explorer label.
export const nodeIsRisky = (tag?: string | null, entityName?: string | null): boolean =>
  isRiskTag(tag) || isRiskName(entityName);
