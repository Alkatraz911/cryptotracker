import { useEffect, useMemo, useRef } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import type { BuiltGraph, GNode } from "../lib/graph";
import { tagById } from "../lib/tags";

interface Props {
  graph: BuiltGraph;
  onSelect: (node: GNode | null) => void;
  focusId?: string | null;
}

export default function GraphView({ graph, onSelect, focusId }: Props) {
  const cyRef = useRef<any>(null);
  const byId = useMemo(() => {
    const m = new Map<string, GNode>();
    for (const n of graph.nodes) m.set(n.id, n);
    return m;
  }, [graph]);

  const elements = useMemo(() => {
    const nodes = graph.nodes.map((n) => {
      const t = tagById(n.tag);
      const marker = n.note ? `\n📌 ${n.note}` : t ? `\n⚑ ${t.label}` : "";
      return {
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
    });
    const edges = graph.edges.map((e) => ({
      data: { id: e.id, source: e.source, target: e.target, label: e.type },
    }));
    return [...nodes, ...edges];
  }, [graph]);

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
    {
      selector: "node[marked = 1]",
      style: { "border-width": 3, "border-color": "#f8fafc", "border-opacity": 0.9 },
    },
    {
      selector: "node:selected",
      style: { "border-width": 4, "border-color": "#38bdf8" },
    },
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

  // focus / highlight a node when selected from the side panel
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !focusId) return;
    const ele = cy.getElementById(focusId);
    if (ele && ele.length) {
      cy.elements().unselect();
      ele.select();
      cy.animate({ center: { eles: ele }, zoom: 1.4 }, { duration: 300 });
    }
  }, [focusId]);

  return (
    <CytoscapeComponent
      elements={elements}
      stylesheet={stylesheet}
      layout={{ name: "cose", animate: false, padding: 30, nodeRepulsion: 8000 } as any}
      style={{ width: "100%", height: "100%" }}
      cy={(cy: any) => {
        cyRef.current = cy;
        cy.removeAllListeners();
        cy.on("tap", "node", (e: any) => onSelect(byId.get(e.target.id()) ?? null));
        cy.on("tap", (e: any) => {
          if (e.target === cy) onSelect(null);
        });
        cy.on("dbltap", "node", (e: any) => {
          const url = e.target.data("url");
          if (url) window.open(url, "_blank", "noopener");
        });
      }}
    />
  );
}
