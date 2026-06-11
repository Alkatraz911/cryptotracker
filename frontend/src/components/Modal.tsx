import { useEffect, type ReactNode } from "react";

interface Props {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}

export default function Modal({ title, onClose, children, width = 380 }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        {title && (
          <div className="modalhead">
            <h2>{title}</h2>
            <button className="x" onClick={onClose}>×</button>
          </div>
        )}
        <div className="modalbody">{children}</div>
      </div>
    </div>
  );
}
