import { useMemo, useRef, useState } from "react";
import type { GNode } from "../lib/graph";
import type { Theme } from "../lib/theme";

interface Props {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  name: string;
  dirty: boolean;
  onEditTitle: (name: string) => void;
  nodes: GNode[];
  onFocusNode: (id: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  hasGraph: boolean;
  onForceLayout: () => void;
  onStructure: () => void;
  mergeMode: boolean;
  onToggleMerge: () => void;
  deleteMode: boolean;
  onToggleDelete: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  onExportJson: () => void;
  onExportPng: () => void;
  onExportReport: () => void;
}

const MAX_RESULTS = 12;

export default function Toolbar({
  sidebarOpen, onToggleSidebar,
  name, dirty, onEditTitle, nodes, onFocusNode,
  canUndo, canRedo, onUndo, onRedo,
  hasGraph, onForceLayout, onStructure, mergeMode, onToggleMerge, deleteMode, onToggleDelete,
  theme, onToggleTheme, onExportJson, onExportPng, onExportReport,
}: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportBlur = useRef<ReturnType<typeof setTimeout> | null>(null);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return nodes
      .filter((n) => {
        const hay = [n.address, n.entityName, n.uid, n.ip, n.hash, n.label]
          .filter(Boolean).join(" ").toLowerCase();
        return hay.includes(s);
      })
      .slice(0, MAX_RESULTS);
  }, [q, nodes]);

  function pick(id: string) {
    onFocusNode(id);
    setQ(""); setOpen(false);
  }

  return (
    <div className="toolbar">
      <button className={`tb-btn${sidebarOpen ? " active" : ""}`} onClick={onToggleSidebar}
        title={sidebarOpen ? "Свернуть панель" : "Развернуть панель"}>☰</button>
      <input
        className="tb-title"
        value={name}
        placeholder="Без названия"
        onChange={(e) => onEditTitle(e.target.value)}
      />
      {dirty && <span className="tb-dirty" title="Не сохранено">•</span>}

      <div className="tb-search">
        <span className="tb-mag">⌕</span>
        <input
          placeholder="Поиск по адресу / метке…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 150); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) pick(results[0].id);
            if (e.key === "Escape") { setQ(""); setOpen(false); }
          }}
        />
        {open && q.trim() && (
          <div className="tb-search-results"
            onMouseDown={() => { if (blurTimer.current) clearTimeout(blurTimer.current); }}>
            {results.length === 0 ? (
              <button disabled>Ничего не найдено</button>
            ) : (
              results.map((n) => (
                <button key={n.id} onClick={() => pick(n.id)}>
                  <div>{n.entityName ?? n.label.replace("\n", " ")}</div>
                  <div className="tsr-sub">
                    {n.kind}{n.net && n.net !== "UNKNOWN" ? ` · ${n.net}` : ""}
                    {n.address ? ` · ${n.address.slice(0, 8)}…${n.address.slice(-4)}` : ""}
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="tb-spacer" />

      <div className="tb-group">
        <button className="tb-btn" onClick={onUndo} disabled={!canUndo} title="Отменить (Ctrl+Z)">↶</button>
        <button className="tb-btn" onClick={onRedo} disabled={!canRedo} title="Повторить (Ctrl+Shift+Z)">↷</button>
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        <button className="tb-btn" onClick={onForceLayout} disabled={!hasGraph} title="Силовая раскладка">↺</button>
        <button className="tb-btn" onClick={onStructure} disabled={!hasGraph} title="Иерархия (без пересечений)">⌗</button>
        <button className={`tb-btn${mergeMode ? " active" : ""}`} onClick={onToggleMerge} disabled={!hasGraph} title="Объединить узлы в сущность">⧉</button>
        <button className={`tb-btn tb-del${deleteMode ? " active" : ""}`} onClick={onToggleDelete} disabled={!hasGraph} title="Удалить несколько узлов">🗑</button>
      </div>

      <div className="tb-sep" />

      <div className="tb-export"
        onBlur={() => { exportBlur.current = setTimeout(() => setExportOpen(false), 150); }}
        onMouseDown={() => { if (exportBlur.current) clearTimeout(exportBlur.current); }}>
        <button className="tb-btn" disabled={!hasGraph} title="Экспорт дела"
          onClick={() => setExportOpen((v) => !v)}>⭳</button>
        {exportOpen && hasGraph && (
          <div className="tb-export-menu">
            <button onClick={() => { setExportOpen(false); onExportReport(); }}>📄 Отчёт (печать / PDF)</button>
            <button onClick={() => { setExportOpen(false); onExportPng(); }}>🖼 Снимок графа (PNG)</button>
            <button onClick={() => { setExportOpen(false); onExportJson(); }}>{"{ }"} Данные дела (JSON)</button>
          </div>
        )}
      </div>

      <div className="tb-sep" />

      <button className="tb-btn" onClick={onToggleTheme} title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}>
        {theme === "dark" ? "☀" : "☾"}
      </button>
    </div>
  );
}
