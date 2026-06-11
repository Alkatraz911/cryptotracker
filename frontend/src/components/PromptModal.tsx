import { useState } from "react";
import Modal from "./Modal";

interface Props {
  title: string;
  label?: string;
  defaultValue?: string;
  confirmText?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

export default function PromptModal({
  title, label, defaultValue = "", confirmText = "ОК", onSubmit, onClose,
}: Props) {
  const [value, setValue] = useState(defaultValue);
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}
      >
        {label && <label>{label}</label>}
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
        <div className="modalactions">
          <button type="button" onClick={onClose}>Отмена</button>
          <button type="submit" className="primary" disabled={!value.trim()}>{confirmText}</button>
        </div>
      </form>
    </Modal>
  );
}
