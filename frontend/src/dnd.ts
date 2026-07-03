/** Drag-and-drop payloads shared by the sidebar and the task list. */

export const DRAG_TYPE = "application/x-tuktuk";

export type DragPayload =
  | { kind: "list"; id: number }
  | { kind: "folder"; id: number }
  | { kind: "task"; id: number };

export function startDrag(event: React.DragEvent, payload: DragPayload): void {
  event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
}

export function readDragPayload(event: React.DragEvent): DragPayload | null {
  const raw = event.dataTransfer.getData(DRAG_TYPE);
  if (raw === "") {
    return null;
  }
  return JSON.parse(raw) as DragPayload;
}
