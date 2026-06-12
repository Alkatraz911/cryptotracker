import { useEffect, useMemo, useRef } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import type { BuiltGraph, GNode } from "../lib/graph";
import { tagById } from "../lib/tags";

interface Props {
  graph: BuiltGraph;
  onSelect: (node: GNode | null) => void;
  focusId?: string | null;
  onPositionsSave: (pos: Record<string, { x: number; y: number }>) => void;
  layoutKey: number;
}

// Module-level constant — stable reference prevents CytoscapeComponent from
// re-running the layout on every elements update. Layout is managed manually
// via cy.layout() in effects below.
const PRESET_LAYOUT = { name: "preset", animate: false };

export default function GraphView({ graph, onSelect, focusId, onPositionsSave, layoutKey }: Props) {
  const cyRef = useRef<any>(null);
  // Initialize to the current layoutKey so the re-layout effect only fires on
  // explicit increments, never on mount (which would wipe saved positions).
  const prevLayoutKey = useRef(layoutKey);

  // Keep mutable refs so event-handler closures always see the latest values
  // without needing to re-register listeners on every render.
  const refs = useRef({ onSelect, onPositionsSave, byId: new Map<string, GNode>() });
  const byId = useMemo(() => {
    const m = new Map<string, GNode>();
    for (const n of graph.nodes) m.set(n.id, n);
    return m;
  }, [graph]);
  refs.current = { onSelect, onPositionsSave, byId };

  const elements = useMemo(() => {
    const nodes = graph.nodes.map((n) => {
      const t = tagById(n.tag);
      const marker = n.note ? `\n📌 ${n.note}` : t ? `\n⚑ ${t.label}` : "";
      const el: any = {
        data: {
          id: n.id,
          label: n.label + marker,
          kind: n.kind,
          color: t ? t.color : n.color,
          url: n.explorerUrl ?? "",
          size: 22 + Math.min(28, n.degree * 3),
          marked: t || n.note ? 1 : 0,
        },
      };
      if (n.x !== undefined && n.y !== undefined) {
        el.position = { x: n.x, y: n.y };
      }
      return el;
    });
    const edges = graph.edges.map((e) => ({
      data: { id: e.id, source: e.source, target: e.target, label: e.type },
    }));
    return [...nodes, ...edges];
  }, [graph]);

  // Helper: capture all node positions and forward to parent.
  function captureAndSave() {
    const cy = cyRef.current;
    if (!cy) return;
    const pos: Record<string, { x: number; y: number }> = {};
    cy.nodes().forEach((n: any) => { pos[n.id()] = { x: n.position("x"), y: n.position("y") }; });
    refs.current.onPositionsSave(pos);
  }

  // Sorted IDs — changes only when nodes are added/removed, not when positions update.
  const nodeKey = useMemo(
    () => graph.nodes.map((n) => n.id).sort().join(","),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph.nodes.length, graph.nodes.map((n) => n.id).join("|")]
  );

  // Run cose layout only for nodes that don't yet have saved positions.
  // Existing positioned nodes are locked so they stay put.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !graph.nodes.length) return;

    const positionless = graph.nodes.filter((n) => n.x === undefined);
    if (!positionless.length) return;

    const allNew = positionless.length === graph.nodes.length;
    if (!allNew) {
      cy.nodes().forEach((node: any) => {
        if (refs.current.byId.get(node.id())?.x !== undefined) node.lock();
      });
    }

    cy.layout({ name: "cose", animate: false, padding: 40, nodeRepulsion: 8000, fit: allNew })
      .one("layoutstop", () => {
        cy.nodes().unlock();
        captureAndSave();
      })
      .run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey]);

  // Explicit full re-layout triggered by parent incrementing layoutKey.
  useEffect(() => {
    if (layoutKey === prevLayoutKey.current) return;
    prevLayoutKey.current = layoutKey;
    const cy = cyRef.current;
    if (!cy) return;
    cy.layout({ name: "cose", animate: true, animationDuration: 500, padding: 40, nodeRepulsion: 8000, fit: true })
      .one("layoutstop", captureAndSave)
      .run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  // Pan/zoom to a node selected from the sidebar.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !focusId) return;
    const ele = cy.getElementById(focusId);
    if (ele?.length) {
      cy.elements().unselect();
      ele.select();
      cy.animate({ center: { eles: ele }, zoom: 1.4 }, { duration: 300 });
    }
  }, [focusId]);

  const stylesheet: any = [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "background-color": "data(color)",
        width: "data(size)",
        height: "data(size)",
        color: "#e5e7eb",
        "font-size": 9,
        "text-wrap": "wrap",
        "text-valign": "bottom",
        "text-margin-y": 3,
        "border-width": 0,
      },
    },
    { selector: 'node[kind = "User"]', style: { shape: "round-rectangle" } },
    { selector: 'node[kind = "IP"]', style: { shape: "diamond" } },
    { selector: 'node[kind = "Tx"]', style: { shape: "ellipse", "font-size": 8 } },
    { selector: "node[marked = 1]", style: { "border-width": 3, "border-color": "#f8fafc", "border-opacity": 0.9 } },
    { selector: "node:selected", style: { "border-width": 4, "border-color": "#38bdf8" } },
    {
      selector: "edge",
      style: {
        label: "data(label)",
        "font-size": 7,
        color: "#9ca3af",
        width: 1.4,
        "line-color": "#4b5563",
        "target-arrow-color": "#4b5563",
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
        "text-rotation": "autorotate",
        "text-background-color": "#0f172a",
        "text-background-opacity": 0.7,
        "text-background-padding": 1,
      },
    },
  ];

  return (
    <CytoscapeComponent
      key={nodeKey}
      elements={elements}
      stylesheet={stylesheet}
      layout={PRESET_LAYOUT as any}
      style={{ width: "100%", height: "100%" }}
      cy={(cy: any) => {
        cyRef.current = cy;
        cy.removeAllListeners();
        cy.on("tap", "node", (e: any) => refs.current.onSelect(refs.current.byId.get(e.target.id()) ?? null));
        cy.on("tap", (e: any) => { if (e.target === cy) refs.current.onSelect(null); });
        cy.on("dbltap", "node", (e: any) => {
          const url = e.target.data("url");
          if (url) window.open(url, "_blank", "noopener");
        });
        // Save positions immediately after each drag so preset layout
        // always restores nodes to where the user left them.
        cy.on("dragfree", () => captureAndSave());
      }}
    />
  );
}
