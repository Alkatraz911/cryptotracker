// Manual markers an investigator can put on nodes. Stored on the node, so
// they persist with the saved project.
export interface TagDef {
  id: string;
  label: string;
  color: string;
}

export const TAGS: TagDef[] = [
  { id: "suspect", label: "Подозрительный", color: "#ef4444" },
  { id: "victim", label: "Жертва", color: "#f59e0b" },
  { id: "exchange", label: "Биржа", color: "#22c55e" },
  { id: "mixer", label: "Миксер", color: "#a855f7" },
  { id: "service", label: "Сервис", color: "#3b82f6" },
  { id: "cashout", label: "Вывод/обнал", color: "#ec4899" },
  { id: "owned", label: "Свой/контроль", color: "#14b8a6" },
];

export const tagById = (id?: string | null): TagDef | undefined =>
  id ? TAGS.find((t) => t.id === id) : undefined;
