import { tr, type Lang } from "../lib/i18n";
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
  collapsed: boolean;
  onToggleCollapse: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  lang: Lang;
  onToggleLang: () => void;
  onFeedback: () => void;
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
  collapsed, onToggleCollapse,
  theme, onToggleTheme, lang, onToggleLang, onFeedback, onExportJson, onExportPng, onExportReport,
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
        title={sidebarOpen ? tr("Свернуть панель") : tr("Развернуть панель")}>☰</button>
      <input
        className="tb-title"
        value={name}
        placeholder={tr("Без названия")}
        onChange={(e) => onEditTitle(e.target.value)}
      />
      {dirty && <span className="tb-dirty" title={tr("Не сохранено")}>•</span>}

      <div className="tb-search">
        <span className="tb-mag">⌕</span>
        <input
          placeholder={tr("Поиск по адресу / метке…")}
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
              <button disabled>{tr("Ничего не найдено")}</button>
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
        <button className="tb-btn" onClick={onUndo} disabled={!canUndo} title={tr("Отменить (Ctrl+Z)")}>↶</button>
        <button className="tb-btn" onClick={onRedo} disabled={!canRedo} title={tr("Повторить (Ctrl+Shift+Z)")}>↷</button>
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        <button className="tb-btn" onClick={onForceLayout} disabled={!hasGraph} title={tr("Силовая раскладка")}>↺</button>
        <button className="tb-btn" onClick={onStructure} disabled={!hasGraph} title={tr("Иерархия (без пересечений)")}>⌗</button>
        <button className={`tb-btn${mergeMode ? " active" : ""}`} onClick={onToggleMerge} disabled={!hasGraph} title={tr("Объединить узлы в сущность")}>⧉</button>
        <button className={`tb-btn tb-del${deleteMode ? " active" : ""}`} onClick={onToggleDelete} disabled={!hasGraph} title={tr("Удалить несколько узлов")}>🗑</button>
        <button className={`tb-btn${collapsed ? " active" : ""}`} onClick={onToggleCollapse} disabled={!hasGraph}
          title={collapsed ? tr("Развернуть переводы") : tr("Свернуть переводы между одними адресами в один")}>⇉</button>
      </div>

      <div className="tb-sep" />

      <div className="tb-export"
        onBlur={() => { exportBlur.current = setTimeout(() => setExportOpen(false), 150); }}
        onMouseDown={() => { if (exportBlur.current) clearTimeout(exportBlur.current); }}>
        <button className="tb-btn" disabled={!hasGraph} title={tr("Экспорт дела")}
          onClick={() => setExportOpen((v) => !v)}>⭳</button>
        {exportOpen && hasGraph && (
          <div className="tb-export-menu">
            <button onClick={() => { setExportOpen(false); onExportReport(); }}>{tr("📄 Отчёт (печать / PDF)")}</button>
            <button onClick={() => { setExportOpen(false); onExportPng(); }}>{tr("🖼 Снимок графа (PNG)")}</button>
            <button onClick={() => { setExportOpen(false); onExportJson(); }}>{"{ }"} {tr("Данные дела (JSON)")}</button>
          </div>
        )}
      </div>

      <div className="tb-sep" />

      <button className="tb-btn" onClick={onToggleTheme} title={theme === "dark" ? tr("Светлая тема") : tr("Тёмная тема")}>
        {theme === "dark" ? "☀" : "☾"}
      </button>
      <button className="tb-btn tb-lang" onClick={onToggleLang}
        title={lang === "ru" ? "Switch to English" : "Переключить на русский"}>
        {lang === "ru" ? "EN" : "RU"}
      </button>
      <button className="tb-btn" onClick={onFeedback} title={tr("Сообщить об ошибке или предложить улучшение")}>✉</button>
    </div>
  );
}
