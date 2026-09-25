import { tr } from "../lib/i18n";
import Modal from "./Modal";

interface Props {
  title?: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export default function ConfirmModal({
  title = tr("Подтверждение"), message, confirmText = tr("ОК"), danger, onConfirm, onClose,
}: Props) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="confirmmsg">{message}</p>
      <div className="modalactions">
        <button onClick={onClose}>{tr("Отмена")}</button>
        <button className={danger ? "danger" : "primary"}
          onClick={() => { onConfirm(); onClose(); }}>
          {confirmText}
        </button>
      </div>
    </Modal>
  );
}
