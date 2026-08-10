/** Drag-and-drop payloads shared by the sidebar and the task list. */

export const DRAG_TYPE = "application/x-tuktuk";

export type DragPayload =
  | { kind: "list"; id: number }
  | { kind: "folder"; id: number }
  | { kind: "task"; id: number }
  | { kind: "check-item"; id: number }
  | { kind: "section"; id: number };

export function startDrag(event: React.DragEvent, payload: DragPayload): void {
  event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
  draggedPayload = payload;
}

export function readDragPayload(event: React.DragEvent): DragPayload | null {
  const raw = event.dataTransfer.getData(DRAG_TYPE);
  if (raw === "") {
    return null;
  }
  return JSON.parse(raw) as DragPayload;
}

// The HTML5 drag-and-drop spec keeps `dataTransfer.getData` opaque during
// dragenter/dragover in real browsers (only `.types` is readable then) — so
// a drop target that needs to react to the payload's *kind* before drop (a
// Folder row deciding whether to highlight, in this app) can't read it off
// the event. Tracked here instead, set synchronously by the row that starts
// the drag and cleared once it ends.
let draggedPayload: DragPayload | null = null;

export function currentDragPayload(): DragPayload | null {
  return draggedPayload;
}

export function endDrag(): void {
  draggedPayload = null;
}
