import { useEffect, useMemo, useRef } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import cytoscape from "cytoscape";
// @ts-expect-error - cytoscape-dagre ships no types
import dagre from "cytoscape-dagre";
import type { BuiltGraph, GNode } from "../lib/graph";
import { networkColor } from "../lib/explorers";
import { tagById, nodeIsRisky } from "../lib/tags";

// Short date (dd.mm.yy) for edge labels, taken from the adjacent Tx node.
const fmtEdgeDate = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { year: "2-digit", month: "2-digit", day: "2-digit" });

const MAX_PIE = 5; // pie slices for multi-network wallet nodes

// Cytoscape can't read CSS variables, so mirror the theme palette here. Keep
// these in sync with the --text/--bg/etc. tokens in styles.css.
const GRAPH_COLORS = {
  dark: { text: "#e5e7eb", muted: "#9ca3af", line: "#4b5563", bg: "#0f172a", selected: "#38bdf8", bridge: "#a855f7", mark: "#f8fafc" },
  light: { text: "#0f172a", muted: "#475569", line: "#94a3b8", bg: "#eef2f7", selected: "#0284c7", bridge: "#9333ea", mark: "#1e293b" },
} as const;

// Register the dagre (hierarchical / layered) layout once at module load.
// Used by the "structure" button to lay edges out without crossings.
let dagreRegistered = false;
if (!dagreRegistered) {
  try { cytoscape.use(dagre); dagreRegistered = true; } catch { /* already registered */ }
}

interface Props {
  graph: BuiltGraph;
  onSelect: (node: GNode | null) => void;
  selectedId?: string | null;
  focusId?: string | null;
  onPositionsSave: (pos: Record<string, { x: number; y: number }>) => void;
  layoutKey: number;
  structureKey: number;
  mergeMode: boolean;
  onMergeSelection: (ids: string[]) => void;
  theme: "dark" | "light";
}

// Module-level constant — stable reference prevents CytoscapeComponent from
// re-running the layout on every elements update. Layout is managed manually
// via cy.layout() in effects below.
const PRESET_LAYOUT = { name: "preset", animate: false, fit: false };

// Zoom slider ↔ zoom level (log scale for a natural feel across the range).
const ZMIN = 0.02, ZMAX = 10;
const zoomToSlider = (z: number) => Math.max(0, Math.min(100, (100 * Math.log(z / ZMIN)) / Math.log(ZMAX / ZMIN)));
const sliderToZoom = (s: number) => ZMIN * Math.pow(ZMAX / ZMIN, s / 100);

export default function GraphView({ graph, onSelect, selectedId, focusId, onPositionsSave, layoutKey, structureKey, mergeMode, onMergeSelection, theme }: Props) {
  const c = GRAPH_COLORS[theme];
  const cyRef = useRef<any>(null);
  // Initialize to the current layoutKey so the re-layout effect only fires on
  // explicit increments, never on mount (which would wipe saved positions).
  const prevLayoutKey = useRef(layoutKey);
  const prevStructureKey = useRef(structureKey);
  // Camera (pan/zoom) preserved across the remount that a node add/remove
  // triggers, so adding a node never resets/jumps the viewport.
  const viewRef = useRef<{ zoom: number; pan: { x: number; y: number } } | null>(null);
  const prevIdsRef = useRef<Set<string>>(new Set());
  // Custom smooth wheel zoom + slider state.
  const sliderRef = useRef<HTMLInputElement>(null);
  const wheelState = useRef<{ target: number; rx: number; ry: number; raf: number }>({ target: 1, rx: 0, ry: 0, raf: 0 });

  // Zoom to an absolute level while keeping the rendered point (rx,ry) fixed.
  // Manual pan math via cy.viewport — robust after a manual pan (cy.zoom's
  // renderedPosition anchoring drifted once pan was non-zero).
  function zoomAt(level: number, rx: number, ry: number) {
    const cy = cyRef.current;
    if (!cy) return;
    const z = Math.max(ZMIN, Math.min(ZMAX, level));
    const pan = cy.pan(), cur = cy.zoom();
    const mx = (rx - pan.x) / cur, my = (ry - pan.y) / cur; // model point under (rx,ry)
    cy.viewport({ zoom: z, pan: { x: rx - mx * z, y: ry - my * z } });
  }
  // Absolute zoom from the slider / buttons: anchor on the GRAPH's own centre
  // (not the screen centre) so the graph scales in place instead of sliding
  // across the screen when the view has been panned.
  function setZoomLevel(level: number) {
    const cy = cyRef.current;
    if (!cy) return;
    const z = Math.max(ZMIN, Math.min(ZMAX, level));
    const els = cy.elements();
    let rx = cy.width() / 2, ry = cy.height() / 2;
    if (els.length) {
      const bb = els.boundingBox();
      const pan = cy.pan(), cur = cy.zoom();
      rx = ((bb.x1 + bb.x2) / 2) * cur + pan.x;
      ry = ((bb.y1 + bb.y2) / 2) * cur + pan.y;
    }
    zoomAt(z, rx, ry);
    wheelState.current.target = z; // keep the smooth-zoom target in sync
  }

  // Keep mutable refs so event-handler closures always see the latest values
  // without needing to re-register listeners on every render.
  const refs = useRef({ onSelect, onPositionsSave, onMergeSelection, mergeMode, byId: new Map<string, GNode>() });
  const byId = useMemo(() => {
    const m = new Map<string, GNode>();
    for (const n of graph.nodes) m.set(n.id, n);
    return m;
  }, [graph]);
  refs.current = { onSelect, onPositionsSave, onMergeSelection, mergeMode, byId };

  // Observer that keeps Cytoscape's rendering in sync with its container size
  // (the container shrinks/grows when the docked side panel opens/closes, which
  // fires no window resize event).
  const resizeObs = useRef<ResizeObserver | null>(null);

  // Multi-select mode (merge / delete) marks nodes with a `sel` data flag rather
  // than Cytoscape's built-in :selected — so any number of nodes can be picked
  // regardless of the core's single/additive selection behaviour. Disable the
  // built-in selection while in the mode so it never fights the manual toggle,
  // and clear the flags on exit.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.autounselectify(mergeMode);
    cy.nodes().unselect();
    if (!mergeMode) cy.nodes().removeData("sel");
  }, [mergeMode]);

  const elements = useMemo(() => {
    const nodes = graph.nodes.map((n) => {
      const t = tagById(n.tag);
      const risky = nodeIsRisky(n.tag, n.entityName);
      const marker = n.note ? `\n📌 ${n.note}` : t ? `\n⚑ ${t.label}` : "";
      // Multi-network wallets: colour the node as pie slices, one per network,
      // so a node active on e.g. Arbitrum+BSC reads as blue+yellow at a glance.
      const nets = n.kind === "Wallet" && !t ? (n.nets ?? []) : [];
      const multi = nets.length > 1 ? 1 : 0;
      const el: any = {
        data: {
          id: n.id,
          label: (risky ? "⚠ " : "") + n.label + marker,
          kind: n.kind,
          color: t ? t.color : n.color,
          url: n.explorerUrl ?? "",
          size: 22 + Math.min(28, n.degree * 3),
          marked: t || n.note ? 1 : 0,
          risk: risky ? 1 : 0,
          multi,
        },
      };
      if (multi) {
        const slice = (100 / nets.length).toFixed(2) + "%";
        for (let i = 0; i < MAX_PIE; i++) {
          el.data[`pc${i + 1}`] = i < nets.length ? networkColor(nets[i]) : "#000";
          el.data[`ps${i + 1}`] = i < nets.length ? slice : "0%";
        }
      }
      if (n.x !== undefined && n.y !== undefined) {
        el.position = { x: n.x, y: n.y };
      }
      return el;
    });
    // Edge labels: money-flow edges (those touching a Tx node) show the
    // transaction date — our model is wallet→Tx→wallet, so the time lives on the
    // adjacent Tx. If that Tx has no timestamp we leave the edge blank rather
    // than print "SENT"/"TO". Structural edges (IP/User links) keep their type.
    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    const edges = graph.edges.map((e) => {
      const s = nodeById.get(e.source);
      const t = nodeById.get(e.target);
      const txNode = s?.kind === "Tx" ? s : t?.kind === "Tx" ? t : undefined;
      const label = txNode
        ? (txNode.timestamp != null ? fmtEdgeDate(txNode.timestamp) : "")
        : e.type;
      return { data: { id: e.id, source: e.source, target: e.target, label } };
    });
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

  // Position nodes that don't yet have a saved position. A fresh graph gets a full
  // cose layout fit to view; an incremental add places each new node BESIDE its
  // already-positioned neighbours without re-fitting — so the existing layout and
  // the viewport stay exactly where they are (no jump / flicker), and the new node
  // appears next to what it connects to instead of far away.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !graph.nodes.length) return;
    const positionless = graph.nodes.filter((n) => n.x === undefined);
    if (!positionless.length) return;

    if (positionless.length === graph.nodes.length) {
      cy.layout({ name: "cose", animate: false, padding: 40, nodeRepulsion: 8000, fit: true })
        .one("layoutstop", () => { cy.nodes().unlock(); captureAndSave(); })
        .run();
      return;
    }

    const adj = new Map<string, string[]>();
    for (const e of graph.edges) {
      (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
      (adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push(e.source);
    }
    const ext = cy.extent();
    const fallback = { x: (ext.x1 + ext.x2) / 2, y: (ext.y1 + ext.y2) / 2 };
    const placed = new Set(graph.nodes.filter((n) => n.x !== undefined).map((n) => n.id));
    const posOf = (id: string) => { const el = cy.getElementById(id); return el.length ? el.position() : undefined; };

    // Several passes so chains (bridge → dstTx → recipient) seed off freshly-placed nodes.
    let pending = positionless.map((n) => n.id);
    for (let pass = 0; pass < 5 && pending.length; pass++) {
      const still: string[] = [];
      const fan = new Map<string, number>();
      for (const id of pending) {
        const nbrs = (adj.get(id) ?? []).filter((x) => placed.has(x));
        if (!nbrs.length) { still.push(id); continue; }
        let sx = 0, sy = 0, k = 0;
        for (const nb of nbrs) { const p = posOf(nb); if (p) { sx += p.x; sy += p.y; k++; } }
        const base = k ? { x: sx / k, y: sy / k } : fallback;
        const key = nbrs.slice().sort().join("|");
        const i = fan.get(key) ?? 0; fan.set(key, i + 1);
        const r = 95 + i * 22;
        cy.getElementById(id).position({ x: base.x + Math.cos(i * 1.1) * r, y: base.y + Math.sin(i * 1.1) * r + 30 });
        placed.add(id);
      }
      pending = still;
    }
    if (pending.length) {
      // New nodes with no positioned neighbour (a disconnected cluster, e.g. an
      // import): grid-seed near the viewport centre, then a LOCAL cose to de-overlap
      // — without touching the rest of the graph or the viewport.
      pending.forEach((id, k) => cy.getElementById(id).position({ x: fallback.x + (k % 6) * 70 - 175, y: fallback.y + Math.floor(k / 6) * 70 - 100 }));
      cy.collection(pending.map((id) => cy.getElementById(id)))
        .layout({ name: "cose", animate: false, fit: false, nodeRepulsion: 6000, randomize: false } as any)
        .one("layoutstop", captureAndSave).run();
    } else {
      captureAndSave();
    }
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

  // Hierarchical (dagre) layout — lays nodes in layers along edge direction so
  // money flows read left→right and edges cross as little as possible.
  useEffect(() => {
    if (structureKey === prevStructureKey.current) return;
    prevStructureKey.current = structureKey;
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().unlock();
    cy.layout({
      name: "dagre",
      rankDir: "LR",        // left → right flow
      nodeSep: 40,          // gap between nodes in the same rank
      rankSep: 90,          // gap between ranks
      edgeSep: 12,
      animate: true,
      animationDuration: 500,
      padding: 40,
      fit: true,
    } as any)
      .one("layoutstop", captureAndSave)
      .run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey]);

  // Pan/zoom to a node focused from a list / search.
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

  // Reflect the side-panel selection as a highlighted node (no pan, so a tap
  // doesn't yank the viewport). Skipped in merge mode, which owns selection.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || mergeMode) return;
    cy.nodes().unselect();
    if (selectedId) {
      const ele = cy.getElementById(selectedId);
      if (ele?.length) ele.select();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, mergeMode, nodeKey]);

  const stylesheet: any = useMemo(() => [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "background-color": "data(color)",
        width: "data(size)",
        height: "data(size)",
        color: c.text,
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
    { selector: 'node[kind = "Entity"]', style: { shape: "hexagon", "font-size": 10, "border-width": 2, "border-color": "#eab308" } },
    {
      // Multi-network wallet: split the node into network-coloured pie slices.
      selector: "node[multi = 1]",
      style: {
        "pie-size": "100%",
        "border-width": 2, "border-color": c.text, "border-opacity": 0.85,
        "pie-1-background-color": "data(pc1)", "pie-1-background-size": "data(ps1)",
        "pie-2-background-color": "data(pc2)", "pie-2-background-size": "data(ps2)",
        "pie-3-background-color": "data(pc3)", "pie-3-background-size": "data(ps3)",
        "pie-4-background-color": "data(pc4)", "pie-4-background-size": "data(ps4)",
        "pie-5-background-color": "data(pc5)", "pie-5-background-size": "data(ps5)",
      },
    },
    { selector: "node[marked = 1]", style: { "border-width": 3, "border-color": c.mark, "border-opacity": 0.9 } },
    // Risk nodes (mixer/suspect/cashout tag or AI-flagged): red ring + ⚠ glyph.
    { selector: "node[risk = 1]", style: { "border-width": 3, "border-color": "#ef4444", "border-opacity": 0.95 } },
    { selector: "node:selected", style: { "border-width": 4, "border-color": c.selected } },
    // Multi-select (merge/delete) highlight — driven by the `sel` data flag.
    { selector: "node[sel = 1]", style: { "border-width": 4, "border-color": c.selected, "border-opacity": 1 } },
    {
      selector: "edge",
      style: {
        label: "data(label)",
        "font-size": 7,
        color: c.muted,
        width: 1.4,
        "line-color": c.line,
        "target-arrow-color": c.line,
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
        "text-rotation": "autorotate",
        "text-background-color": c.bg,
        "text-background-opacity": 0.7,
        "text-background-padding": 1,
      },
    },
    {
      selector: 'edge[label = "BRIDGE"]',
      style: {
        "line-color": c.bridge, "target-arrow-color": c.bridge,
        "line-style": "dashed", width: 2,
      },
    },
  ], [c]);

  // Re-apply the stylesheet to the live instance when the theme changes
  // (CytoscapeComponent does not always diff a new stylesheet prop reliably).
  useEffect(() => {
    const cy = cyRef.current;
    if (cy) cy.style().fromJson(stylesheet).update();
  }, [stylesheet]);

  return (
    <div className="graph-wrap">
    <CytoscapeComponent
      key={nodeKey}
      elements={elements}
      stylesheet={stylesheet}
      layout={PRESET_LAYOUT as any}
      style={{ width: "100%", height: "100%" }}
      cy={(cy: any) => {
        cyRef.current = cy;
        cy.removeAllListeners();
        cy.autounselectify(refs.current.mergeMode); // honour select mode on a fresh instance
        // (Re)attach a ResizeObserver to the (possibly new) container element.
        resizeObs.current?.disconnect();
        if (typeof ResizeObserver !== "undefined") {
          const el = cy.container();
          if (el) {
            resizeObs.current = new ResizeObserver(() => cy.resize());
            resizeObs.current.observe(el);
          }
        }
        cy.on("tap", "node", (e: any) => {
          // In merge mode a tap toggles selection (for entity merge) instead of
          // opening the node dialog; report the current selection to the parent.
          if (refs.current.mergeMode) {
            const n = e.target;
            if (n.data("sel")) n.removeData("sel"); else n.data("sel", 1);
            refs.current.onMergeSelection(cy.nodes("[sel = 1]").map((x: any) => x.id()));
            return;
          }
          refs.current.onSelect(refs.current.byId.get(e.target.id()) ?? null);
        });
        cy.on("tap", (e: any) => { if (e.target === cy && !refs.current.mergeMode) refs.current.onSelect(null); });
        cy.on("dbltap", "node", (e: any) => {
          if (refs.current.mergeMode) return;
          const url = e.target.data("url");
          if (url) window.open(url, "_blank", "noopener");
        });
        // Save positions immediately after each drag so preset layout
        // always restores nodes to where the user left them.
        cy.on("dragfree", () => captureAndSave());
        // Remember the camera on every pan/zoom + keep the zoom slider in sync
        // (DOM write only — no React re-render during interaction).
        cy.on("viewport", () => {
          viewRef.current = { zoom: cy.zoom(), pan: { ...cy.pan() } };
          // Don't overwrite the slider while the user is dragging it (avoids the
          // thumb fighting the pointer); the drag itself is driving the zoom.
          if (sliderRef.current && document.activeElement !== sliderRef.current)
            sliderRef.current.value = String(zoomToSlider(cy.zoom()));
        });

        // Custom smooth, coalesced wheel zoom toward the cursor. Cytoscape's
        // built-in wheel zoom applies one discrete step per event → jerky on fast
        // scroll; we accumulate a target and ease toward it once per frame.
        if (wheelState.current.raf) cancelAnimationFrame(wheelState.current.raf);
        wheelState.current = { target: cy.zoom(), rx: 0, ry: 0, raf: 0 };
        cy.userZoomingEnabled(false);
        const cont = cy.container();
        if (cont) {
          const st = wheelState.current;
          cont.addEventListener("wheel", (ev: WheelEvent) => {
            ev.preventDefault();
            const rect = cont.getBoundingClientRect();
            st.rx = ev.clientX - rect.left;
            st.ry = ev.clientY - rect.top;
            st.target = Math.max(ZMIN, Math.min(ZMAX, st.target * Math.exp(-ev.deltaY * 0.0012)));
            if (!st.raf) {
              const stepZoom = () => {
                const cur = cy.zoom();
                if (Math.abs(st.target - cur) < 0.003) {
                  zoomAt(st.target, st.rx, st.ry);
                  st.raf = 0; return;
                }
                zoomAt(cur + (st.target - cur) * 0.3, st.rx, st.ry);
                st.raf = requestAnimationFrame(stepZoom);
              };
              st.raf = requestAnimationFrame(stepZoom);
            }
          }, { passive: false });
        }
        // On a remount (node add/remove): keep the camera exactly where it was;
        // only fit for a fresh graph or a project switch (little/no id overlap).
        const curIds = graph.nodes.map((n) => n.id);
        let shared = 0;
        for (const id of curIds) if (prevIdsRef.current.has(id)) shared++;
        const incremental = prevIdsRef.current.size > 0 && shared >= Math.min(curIds.length, prevIdsRef.current.size) * 0.5;
        prevIdsRef.current = new Set(curIds);
        if (incremental && viewRef.current) cy.viewport({ zoom: viewRef.current.zoom, pan: viewRef.current.pan });
        else if (curIds.length) cy.fit(undefined, 40);
        // The fit/restore above changed the zoom — resync the smooth-zoom target
        // and the slider so the first wheel/drag starts from the real level.
        wheelState.current.target = cy.zoom();
        if (sliderRef.current) sliderRef.current.value = String(zoomToSlider(cy.zoom()));
      }}
    />
      <div className="zoom-ctl">
        <button className="zc-btn" title="Приблизить" onClick={() => setZoomLevel((cyRef.current?.zoom() ?? 1) * 1.3)}>+</button>
        <input
          ref={sliderRef}
          className="zc-slider"
          type="range"
          min={0}
          max={100}
          step={0.5}
          defaultValue={50}
          title="Масштаб"
          onInput={(e) => setZoomLevel(sliderToZoom(Number((e.target as HTMLInputElement).value)))}
        />
        <button className="zc-btn" title="Отдалить" onClick={() => setZoomLevel((cyRef.current?.zoom() ?? 1) / 1.3)}>−</button>
      </div>
    </div>
  );
}
