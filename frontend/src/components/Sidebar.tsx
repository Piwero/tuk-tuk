import { useState } from "react";

import {
  createFolder,
  createList,
  deleteFolder,
  deleteList,
  updateFolder,
  updateList,
  updateTask,
  type Folder,
  type Task,
  type TaskList,
} from "../api";
import { readDragPayload, startDrag } from "../dnd";

type Editor =
  | { mode: "create-list" }
  | { mode: "edit-list"; listId: number }
  | { mode: "create-folder" }
  | { mode: "rename-folder"; folderId: number }
  | null;

interface SidebarProps {
  lists: TaskList[];
  folders: Folder[];
  selectedListId: number | null;
  onSelect: (listId: number) => void;
  onListsChanged: (update: (current: TaskList[]) => TaskList[]) => void;
  onFoldersChanged: (update: (current: Folder[]) => Folder[]) => void;
  onTaskMoved: (task: Task) => void;
}

const byOrder = (a: { sort_order: number; id: number }, b: { sort_order: number; id: number }) =>
  a.sort_order - b.sort_order || a.id - b.id;

const SORT_GAP = 1024;

/** Sparse-order value that lands the moved row before `next`. */
function insertionOrder(prev: number | undefined, next: number): number {
  return prev === undefined ? next - SORT_GAP : Math.floor((prev + next) / 2);
}

function ListButton({
  list,
  selected,
  onSelect,
}: {
  list: TaskList;
  selected: boolean;
  onSelect: (listId: number) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={selected ? "list-button selected" : "list-button"}
      onClick={() => onSelect(list.id)}
    >
      {list.color !== null && <span className="color-dot" style={{ background: list.color }} />}
      {list.emoji !== null && <span className="list-emoji">{list.emoji}</span>}
      {list.name}
    </button>
  );
}

interface ListFormValues {
  name: string;
  color: string;
  emoji: string;
}

function ListForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: Pick<TaskList, "name" | "color" | "emoji">;
  onSubmit: (values: ListFormValues) => void;
  onCancel: () => void;
}): JSX.Element {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? "#4772fa");
  const [emoji, setEmoji] = useState(initial?.emoji ?? "");

  return (
    <form
      className="list-form"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (trimmed === "") {
          return;
        }
        onSubmit({ name: trimmed, color, emoji: emoji.trim() });
      }}
    >
      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Color
        <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
      </label>
      <label>
        Emoji
        <input value={emoji} maxLength={8} onChange={(event) => setEmoji(event.target.value)} />
      </label>
      <button type="submit">Save</button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

function FolderForm({
  initialName,
  onSubmit,
  onCancel,
}: {
  initialName?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [name, setName] = useState(initialName ?? "");

  return (
    <form
      className="list-form"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (trimmed === "") {
          return;
        }
        onSubmit(trimmed);
      }}
    >
      <label>
        Folder name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <button type="submit">Save</button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

export function Sidebar({
  lists,
  folders,
  selectedListId,
  onSelect,
  onListsChanged,
  onFoldersChanged,
  onTaskMoved,
}: SidebarProps): JSX.Element {
  const [editor, setEditor] = useState<Editor>(null);

  const inbox = lists.find((list) => list.is_inbox);
  const active = lists.filter((list) => !list.is_inbox && !list.is_archived);
  const archivedLists = lists.filter((list) => !list.is_inbox && list.is_archived).sort(byOrder);
  const looseLists = active.filter((list) => list.folder_id === null).sort(byOrder);
  const membersOf = (folderId: number): TaskList[] =>
    active.filter((list) => list.folder_id === folderId).sort(byOrder);

  async function handleCreateList(values: ListFormValues): Promise<void> {
    const created = await createList({
      name: values.name,
      color: values.color,
      ...(values.emoji === "" ? {} : { emoji: values.emoji }),
    });
    onListsChanged((current) => [...current, created]);
    setEditor(null);
  }

  async function handleEditList(list: TaskList, values: ListFormValues): Promise<void> {
    const updated = await updateList(list.id, {
      name: values.name,
      color: values.color,
      emoji: values.emoji === "" ? null : values.emoji,
    });
    onListsChanged((current) => current.map((l) => (l.id === updated.id ? updated : l)));
    setEditor(null);
  }

  async function handleSetArchived(list: TaskList, isArchived: boolean): Promise<void> {
    const updated = await updateList(list.id, { is_archived: isArchived });
    onListsChanged((current) => current.map((l) => (l.id === updated.id ? updated : l)));
  }

  async function handleCreateFolder(name: string): Promise<void> {
    const created = await createFolder(name);
    onFoldersChanged((current) => [...current, created]);
    setEditor(null);
  }

  async function handleRenameFolder(folder: Folder, name: string): Promise<void> {
    const updated = await updateFolder(folder.id, { name });
    onFoldersChanged((current) => current.map((f) => (f.id === updated.id ? updated : f)));
    setEditor(null);
  }

  async function handleDeleteFolder(folder: Folder): Promise<void> {
    const confirmed = window.confirm(
      `Delete the folder "${folder.name}"? Its lists move back to the top level.`,
    );
    if (!confirmed) {
      return;
    }
    await deleteFolder(folder.id);
    onFoldersChanged((current) => current.filter((f) => f.id !== folder.id));
    onListsChanged((current) =>
      current.map((list) => (list.folder_id === folder.id ? { ...list, folder_id: null } : list)),
    );
  }

  async function handleDeleteList(list: TaskList): Promise<void> {
    const confirmed = window.confirm(
      `Delete the list "${list.name}" and all of its tasks? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }
    await deleteList(list.id);
    onListsChanged((current) => current.filter((l) => l.id !== list.id));
  }

  async function moveListBefore(listId: number, target: TaskList): Promise<void> {
    const moved = lists.find((list) => list.id === listId);
    if (moved === undefined) {
      return;
    }
    const siblings = (target.folder_id === null ? looseLists : membersOf(target.folder_id)).filter(
      (list) => list.id !== listId,
    );
    const targetIndex = siblings.findIndex((list) => list.id === target.id);
    const prev = targetIndex > 0 ? siblings[targetIndex - 1] : undefined;
    const sortOrder = insertionOrder(prev?.sort_order, target.sort_order);
    if (prev !== undefined && sortOrder <= prev.sort_order) {
      // The gap between neighbours is exhausted: renumber the whole group sparsely.
      const arrangement = [...siblings];
      arrangement.splice(targetIndex, 0, moved);
      const updates = await Promise.all(
        arrangement.map((row, index) =>
          updateList(row.id, {
            sort_order: (index + 1) * SORT_GAP,
            ...(row.id === listId ? { folder_id: target.folder_id } : {}),
          }),
        ),
      );
      onListsChanged((current) =>
        current.map((l) => updates.find((updated) => updated.id === l.id) ?? l),
      );
      return;
    }
    const updated = await updateList(listId, {
      folder_id: target.folder_id,
      sort_order: sortOrder,
    });
    onListsChanged((current) => current.map((l) => (l.id === updated.id ? updated : l)));
  }

  async function moveTaskToList(taskId: number, listId: number): Promise<void> {
    const moved = await updateTask(taskId, { list_id: listId });
    onTaskMoved(moved);
  }

  function handleDropOnList(event: React.DragEvent, target: TaskList): void {
    event.preventDefault();
    const payload = readDragPayload(event);
    if (payload === null) {
      return;
    }
    if (payload.kind === "list" && payload.id !== target.id) {
      void moveListBefore(payload.id, target);
    }
    if (payload.kind === "task") {
      void moveTaskToList(payload.id, target.id);
    }
  }

  async function moveListIntoFolder(listId: number, folder: Folder): Promise<void> {
    const members = membersOf(folder.id).filter((list) => list.id !== listId);
    const last = members[members.length - 1];
    const updated = await updateList(listId, {
      folder_id: folder.id,
      sort_order: last === undefined ? SORT_GAP : last.sort_order + SORT_GAP,
    });
    onListsChanged((current) => current.map((l) => (l.id === updated.id ? updated : l)));
  }

  async function moveFolderBefore(folderId: number, target: Folder): Promise<void> {
    const moved = folders.find((folder) => folder.id === folderId);
    if (moved === undefined) {
      return;
    }
    const siblings = [...folders].sort(byOrder).filter((folder) => folder.id !== folderId);
    const targetIndex = siblings.findIndex((folder) => folder.id === target.id);
    const prev = targetIndex > 0 ? siblings[targetIndex - 1] : undefined;
    const sortOrder = insertionOrder(prev?.sort_order, target.sort_order);
    if (prev !== undefined && sortOrder <= prev.sort_order) {
      // The gap between neighbours is exhausted: renumber the folders sparsely.
      const arrangement = [...siblings];
      arrangement.splice(targetIndex, 0, moved);
      const updates = await Promise.all(
        arrangement.map((row, index) =>
          updateFolder(row.id, { sort_order: (index + 1) * SORT_GAP }),
        ),
      );
      onFoldersChanged((current) =>
        current.map((f) => updates.find((updated) => updated.id === f.id) ?? f),
      );
      return;
    }
    const updated = await updateFolder(folderId, { sort_order: sortOrder });
    onFoldersChanged((current) => current.map((f) => (f.id === updated.id ? updated : f)));
  }

  function handleDropOnFolder(event: React.DragEvent, folder: Folder): void {
    event.preventDefault();
    const payload = readDragPayload(event);
    if (payload === null) {
      return;
    }
    if (payload.kind === "list") {
      void moveListIntoFolder(payload.id, folder);
    }
    if (payload.kind === "folder" && payload.id !== folder.id) {
      void moveFolderBefore(payload.id, folder);
    }
  }

  function renderListItem(list: TaskList): JSX.Element {
    if (editor?.mode === "edit-list" && editor.listId === list.id) {
      return (
        <li key={list.id}>
          <ListForm
            initial={list}
            onSubmit={(values) => void handleEditList(list, values)}
            onCancel={() => setEditor(null)}
          />
        </li>
      );
    }
    return (
      <li key={list.id}>
        <div
          className="list-row"
          draggable
          onDragStart={(event) => startDrag(event, { kind: "list", id: list.id })}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => handleDropOnList(event, list)}
        >
          <ListButton list={list} selected={list.id === selectedListId} onSelect={onSelect} />
          <span className="row-actions">
            <button
              type="button"
              aria-label={`Edit ${list.name}`}
              onClick={() => setEditor({ mode: "edit-list", listId: list.id })}
            >
              ✎
            </button>
            <button
              type="button"
              aria-label={`Archive ${list.name}`}
              onClick={() => void handleSetArchived(list, true)}
            >
              🗄
            </button>
            <button
              type="button"
              aria-label={`Delete list ${list.name}`}
              onClick={() => void handleDeleteList(list)}
            >
              ✕
            </button>
          </span>
        </div>
      </li>
    );
  }

  return (
    <aside className="sidebar">
      <nav aria-label="Lists">
        <ul>
          {inbox && (
            <li>
              <div
                className="list-row"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const payload = readDragPayload(event);
                  if (payload?.kind === "task") {
                    void moveTaskToList(payload.id, inbox.id);
                  }
                }}
              >
                <ListButton
                  list={inbox}
                  selected={inbox.id === selectedListId}
                  onSelect={onSelect}
                />
              </div>
            </li>
          )}
          {[...folders].sort(byOrder).map((folder) => (
            <li key={`folder-${folder.id}`} className="folder">
              {editor?.mode === "rename-folder" && editor.folderId === folder.id ? (
                <FolderForm
                  initialName={folder.name}
                  onSubmit={(name) => void handleRenameFolder(folder, name)}
                  onCancel={() => setEditor(null)}
                />
              ) : (
                <div
                  className="folder-row"
                  draggable
                  onDragStart={(event) => startDrag(event, { kind: "folder", id: folder.id })}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => handleDropOnFolder(event, folder)}
                >
                  <span className="folder-name">{folder.name}</span>
                  <span className="row-actions">
                    <button
                      type="button"
                      aria-label={`Rename folder ${folder.name}`}
                      onClick={() => setEditor({ mode: "rename-folder", folderId: folder.id })}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete folder ${folder.name}`}
                      onClick={() => void handleDeleteFolder(folder)}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              )}
              <ul className="folder-lists" aria-label={`Lists in ${folder.name}`}>
                {membersOf(folder.id).map((list) => renderListItem(list))}
              </ul>
            </li>
          ))}
          {looseLists.map((list) => renderListItem(list))}
        </ul>
      </nav>
      <div className="sidebar-actions">
        {editor?.mode === "create-list" && (
          <ListForm
            onSubmit={(values) => void handleCreateList(values)}
            onCancel={() => setEditor(null)}
          />
        )}
        {editor?.mode === "create-folder" && (
          <FolderForm
            onSubmit={(name) => void handleCreateFolder(name)}
            onCancel={() => setEditor(null)}
          />
        )}
        {(editor === null || editor.mode === "edit-list") && (
          <>
            <button type="button" onClick={() => setEditor({ mode: "create-list" })}>
              Add List
            </button>
            <button type="button" onClick={() => setEditor({ mode: "create-folder" })}>
              Add Folder
            </button>
          </>
        )}
      </div>
      {archivedLists.length > 0 && (
        <section className="archived" aria-label="Archived">
          <h2>Archived</h2>
          <ul>
            {archivedLists.map((list) => (
              <li key={list.id}>
                <div className="list-row">
                  <ListButton
                    list={list}
                    selected={list.id === selectedListId}
                    onSelect={onSelect}
                  />
                  <span className="row-actions">
                    <button
                      type="button"
                      aria-label={`Unarchive ${list.name}`}
                      onClick={() => void handleSetArchived(list, false)}
                    >
                      ↩
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
