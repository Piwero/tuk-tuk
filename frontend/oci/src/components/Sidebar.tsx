import { useState } from "react";

import {
  createFolder,
  createList,
  createTag,
  deleteFolder,
  deleteList,
  deleteTag,
  updateFolder,
  updateList,
  updateTag,
  updateTask,
  SMART_LABELS,
  type Folder,
  type SmartView,
  type Tag,
  type Task,
  type TaskList,
} from "../api";
import { readDragPayload, startDrag } from "../dnd";
import { appendOrder, byName, byOrder, planInsertBefore } from "../ordering";
import { FocusNavBadge } from "./FocusNavBadge";
import { FolderForm } from "./FolderForm";
import { Icon, type IconName } from "./Icon";
import { ListForm, type ListFormValues } from "./ListForm";
import { TagForm, type TagFormValues } from "./TagForm";

const SMART_ICONS: Record<SmartView, IconName> = {
  today: "sun",
  next7: "calendar-range",
  all: "layers",
};

type Editor =
  | { mode: "create-list" }
  | { mode: "edit-list"; listId: number }
  | { mode: "create-folder" }
  | { mode: "rename-folder"; folderId: number }
  | { mode: "create-tag" }
  | { mode: "edit-tag"; tagId: number }
  | null;

interface SidebarProps {
  lists: TaskList[];
  folders: Folder[];
  tags: Tag[];
  selectedListId: number | null;
  selectedTagId: number | null;
  selectedSmart: SmartView | null;
  calendarSelected: boolean;
  habitsSelected: boolean;
  focusSelected: boolean;
  settingsSelected: boolean;
  onSelect: (listId: number) => void;
  onSelectTag: (tagId: number) => void;
  onSelectSmart: (view: SmartView) => void;
  onSelectCalendar: () => void;
  onSelectHabits: () => void;
  onSelectFocus: () => void;
  onSelectSettings: () => void;
  onSearch: (query: string) => void;
  /** Opens the Quick add dialog; the sidebar is always there, so capture is
   * reachable from every screen, including Habits and Focus. */
  onQuickAdd: () => void;
  /** Icons-only rail: labels, search and section headings step aside to give
   * the main view its width back. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onListsChanged: (update: (current: TaskList[]) => TaskList[]) => void;
  onFoldersChanged: (update: (current: Folder[]) => Folder[]) => void;
  onTagCreated: (tag: Tag) => void;
  onTagSaved: (tag: Tag) => void;
  onTagDeleted: (tagId: number) => void;
  onTaskMoved: (task: Task) => void;
  /** Absent when the sidebar is rendered without AuthGate (most tests) —
   * the log out control only appears once there is somewhere for it to go. */
  onLogout?: () => void;
}

interface ListButtonProps {
  list: TaskList;
  selected: boolean;
  collapsed: boolean;
  onSelect: (listId: number) => void;
}

function ListButton({ list, selected, collapsed, onSelect }: ListButtonProps): JSX.Element {
  // Collapsed, the row is only as wide as its glyph — so a List with neither a
  // color nor an emoji falls back to its initial rather than showing nothing.
  const bare = list.color === null && list.emoji === null;
  return (
    <button
      type="button"
      className={selected ? "list-button selected" : "list-button"}
      // Only on the rail: expanded, the name comes from the label itself —
      // emoji included, which is the name the rest of the app expects.
      aria-label={collapsed ? list.name : undefined}
      title={collapsed ? list.name : undefined}
      onClick={() => onSelect(list.id)}
    >
      {list.is_inbox ? (
        <Icon name="inbox" size={18} />
      ) : (
        <>
          {list.color !== null && <span className="color-dot" style={{ background: list.color }} />}
          {list.emoji !== null && <span className="list-emoji">{list.emoji}</span>}
          {collapsed && bare && <span className="list-initial">{list.name.slice(0, 1)}</span>}
        </>
      )}
      <span className="nav-label">{list.name}</span>
    </button>
  );
}

interface TopNavItemProps {
  icon: IconName;
  label: string;
  selected: boolean;
  collapsed: boolean;
  onClick: () => void;
}

/** One item in the top feature row: selected = pill with icon + label, others icon-only. */
function TopNavItem({ icon, label, selected, collapsed, onClick }: TopNavItemProps): JSX.Element {
  return (
    <button
      type="button"
      className={selected ? "top-nav-item selected" : "top-nav-item"}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon name={icon} size={18} />
      {selected && !collapsed && <span>{label}</span>}
    </button>
  );
}

export function Sidebar({
  lists,
  folders,
  tags,
  selectedListId,
  selectedTagId,
  selectedSmart,
  calendarSelected,
  habitsSelected,
  focusSelected,
  settingsSelected,
  onSelect,
  onSelectTag,
  onSelectSmart,
  onSelectCalendar,
  onSelectHabits,
  onSelectFocus,
  onSelectSettings,
  onSearch,
  onQuickAdd,
  collapsed,
  onToggleCollapsed,
  onListsChanged,
  onFoldersChanged,
  onTagCreated,
  onTagSaved,
  onTagDeleted,
  onTaskMoved,
  onLogout,
}: SidebarProps): JSX.Element {
  const [editor, setEditor] = useState<Editor>(null);

  const inbox = lists.find((list) => list.is_inbox);
  const active = lists.filter((list) => !list.is_inbox && !list.is_archived);
  const archivedLists = lists.filter((list) => !list.is_inbox && list.is_archived).sort(byOrder);
  const looseLists = active.filter((list) => list.folder_id === null).sort(byOrder);
  const membersOf = (folderId: number): TaskList[] =>
    active.filter((list) => list.folder_id === folderId).sort(byOrder);

  function applyListUpdate(updated: TaskList): void {
    onListsChanged((current) => current.map((l) => (l.id === updated.id ? updated : l)));
  }

  function applyListUpdates(updates: TaskList[]): void {
    onListsChanged((current) =>
      current.map((l) => updates.find((updated) => updated.id === l.id) ?? l),
    );
  }

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
    applyListUpdate(updated);
    setEditor(null);
  }

  async function handleSetArchived(list: TaskList, isArchived: boolean): Promise<void> {
    applyListUpdate(await updateList(list.id, { is_archived: isArchived }));
  }

  async function handleCreateFolder(name: string): Promise<void> {
    const created = await createFolder(name);
    onFoldersChanged((current) => [...current, created]);
    setEditor(null);
  }

  async function handleCreateTag(values: TagFormValues): Promise<void> {
    onTagCreated(await createTag({ name: values.name, color: values.color }));
    setEditor(null);
  }

  async function handleEditTag(tag: Tag, values: TagFormValues): Promise<void> {
    onTagSaved(await updateTag(tag.id, { name: values.name, color: values.color }));
    setEditor(null);
  }

  async function handleDeleteTag(tag: Tag): Promise<void> {
    const confirmed = window.confirm(
      `Delete the tag "${tag.name}"? It will be removed from all tasks; the tasks stay.`,
    );
    if (!confirmed) {
      return;
    }
    await deleteTag(tag.id);
    onTagDeleted(tag.id);
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
    const plan = planInsertBefore(siblings, moved, target.id);
    if (plan.kind === "single") {
      applyListUpdate(
        await updateList(listId, { folder_id: target.folder_id, sort_order: plan.sort_order }),
      );
      return;
    }
    applyListUpdates(
      await Promise.all(
        plan.rows.map(({ row, sort_order }) =>
          updateList(row.id, {
            sort_order,
            ...(row.id === listId ? { folder_id: target.folder_id } : {}),
          }),
        ),
      ),
    );
  }

  async function moveListIntoFolder(listId: number, folder: Folder): Promise<void> {
    const members = membersOf(folder.id).filter((list) => list.id !== listId);
    applyListUpdate(
      await updateList(listId, { folder_id: folder.id, sort_order: appendOrder(members) }),
    );
  }

  /** Dropping on empty sidebar space moves a list out of its folder, to the end. */
  async function moveListToTopLevelEnd(listId: number): Promise<void> {
    const siblings = looseLists.filter((list) => list.id !== listId);
    applyListUpdate(
      await updateList(listId, { folder_id: null, sort_order: appendOrder(siblings) }),
    );
  }

  async function moveFolderBefore(folderId: number, target: Folder): Promise<void> {
    const moved = folders.find((folder) => folder.id === folderId);
    if (moved === undefined) {
      return;
    }
    const siblings = [...folders].sort(byOrder).filter((folder) => folder.id !== folderId);
    const plan = planInsertBefore(siblings, moved, target.id);
    const updates =
      plan.kind === "single"
        ? [await updateFolder(folderId, { sort_order: plan.sort_order })]
        : await Promise.all(
            plan.rows.map(({ row, sort_order }) => updateFolder(row.id, { sort_order })),
          );
    onFoldersChanged((current) =>
      current.map((f) => updates.find((updated) => updated.id === f.id) ?? f),
    );
  }

  async function moveTaskToList(taskId: number, listId: number): Promise<void> {
    const moved = await updateTask(taskId, { list_id: listId });
    onTaskMoved(moved);
  }

  function handleDropOnList(event: React.DragEvent, target: TaskList): void {
    event.preventDefault();
    event.stopPropagation();
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

  function handleDropOnFolder(event: React.DragEvent, folder: Folder): void {
    event.preventDefault();
    event.stopPropagation();
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

  function handleDropOnNav(event: React.DragEvent): void {
    event.preventDefault();
    const payload = readDragPayload(event);
    if (payload?.kind === "list") {
      void moveListToTopLevelEnd(payload.id);
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
          <ListButton
            list={list}
            selected={list.id === selectedListId}
            collapsed={collapsed}
            onSelect={onSelect}
          />
          <span className="row-actions">
            <button
              type="button"
              aria-label={`Edit ${list.name}`}
              onClick={() => setEditor({ mode: "edit-list", listId: list.id })}
            >
              <Icon name="pencil" />
            </button>
            <button
              type="button"
              aria-label={`Archive ${list.name}`}
              onClick={() => void handleSetArchived(list, true)}
            >
              <Icon name="archive" />
            </button>
            <button
              type="button"
              aria-label={`Delete list ${list.name}`}
              onClick={() => void handleDeleteList(list)}
            >
              <Icon name="x" />
            </button>
          </span>
        </div>
      </li>
    );
  }

  const tasksSelected = !calendarSelected && !habitsSelected && !focusSelected && !settingsSelected;

  return (
    <aside className={collapsed ? "sidebar collapsed" : "sidebar"}>
      <div className="sidebar-top">
        <div className="sidebar-brand">Tuk Tuk</div>
        <FocusNavBadge onOpen={onSelectFocus} />
        <button
          type="button"
          className="sidebar-collapse"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          <Icon name={collapsed ? "chevron-right" : "chevron-left"} size={18} />
        </button>
      </div>
      <nav aria-label="Views" className="top-nav">
        <TopNavItem
          icon="list-checks"
          label="Tasks"
          selected={tasksSelected}
          collapsed={collapsed}
          onClick={() => onSelectSmart("today")}
        />
        <TopNavItem
          icon="calendar-days"
          label="Calendar"
          selected={calendarSelected}
          collapsed={collapsed}
          onClick={onSelectCalendar}
        />
        <TopNavItem
          icon="repeat"
          label="Habits"
          selected={habitsSelected}
          collapsed={collapsed}
          onClick={onSelectHabits}
        />
        <TopNavItem
          icon="timer"
          label="Focus"
          selected={focusSelected}
          collapsed={collapsed}
          onClick={onSelectFocus}
        />
      </nav>
      {!collapsed && (
        <form
          role="search"
          className="sidebar-search"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch(new FormData(event.currentTarget).get("query")?.toString() ?? "");
          }}
        >
          <input type="search" name="query" aria-label="Search tasks" placeholder="Search…" />
        </form>
      )}
      <button
        type="button"
        className="quick-add-trigger"
        aria-label="Quick add"
        title="Quick add"
        onClick={onQuickAdd}
      >
        <Icon name="plus" />
        <span className="nav-label">Quick add</span>
      </button>
      <nav aria-label="Smart Lists" className="smart-lists">
        {(Object.keys(SMART_LABELS) as SmartView[]).map((view) => (
          <button
            key={view}
            type="button"
            className={selectedSmart === view ? "list-button selected" : "list-button"}
            aria-label={SMART_LABELS[view]}
            title={SMART_LABELS[view]}
            onClick={() => onSelectSmart(view)}
          >
            <Icon name={SMART_ICONS[view]} size={18} />
            <span className="nav-label">{SMART_LABELS[view]}</span>
          </button>
        ))}
      </nav>
      <nav
        aria-label="Lists"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDropOnNav}
      >
        <ul>
          {inbox && (
            <li>
              <div
                className="list-row"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const payload = readDragPayload(event);
                  if (payload?.kind === "task") {
                    void moveTaskToList(payload.id, inbox.id);
                  }
                }}
              >
                <ListButton
                  list={inbox}
                  selected={inbox.id === selectedListId}
                  collapsed={collapsed}
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
                      <Icon name="pencil" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete folder ${folder.name}`}
                      onClick={() => void handleDeleteFolder(folder)}
                    >
                      <Icon name="x" />
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
      <nav aria-label="Tags" className="tags-nav">
        <h2>Tags</h2>
        <ul>
          {[...tags].sort(byName).map((tag) =>
            editor?.mode === "edit-tag" && editor.tagId === tag.id ? (
              <li key={tag.id}>
                <TagForm
                  initial={tag}
                  onSubmit={(values) => handleEditTag(tag, values)}
                  onCancel={() => setEditor(null)}
                />
              </li>
            ) : (
              <li key={tag.id}>
                <div className="list-row">
                  <button
                    type="button"
                    className={tag.id === selectedTagId ? "list-button selected" : "list-button"}
                    aria-label={tag.name}
                    title={tag.name}
                    onClick={() => onSelectTag(tag.id)}
                  >
                    {tag.color !== null ? (
                      <span className="color-dot" style={{ background: tag.color }} />
                    ) : (
                      collapsed && <span className="list-initial">{tag.name.slice(0, 1)}</span>
                    )}
                    <span className="nav-label">{tag.name}</span>
                  </button>
                  <span className="row-actions">
                    <button
                      type="button"
                      aria-label={`Edit tag ${tag.name}`}
                      onClick={() => setEditor({ mode: "edit-tag", tagId: tag.id })}
                    >
                      <Icon name="pencil" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete tag ${tag.name}`}
                      onClick={() => void handleDeleteTag(tag)}
                    >
                      <Icon name="x" />
                    </button>
                  </span>
                </div>
              </li>
            ),
          )}
        </ul>
        {editor?.mode === "create-tag" ? (
          <TagForm
            onSubmit={(values) => handleCreateTag(values)}
            onCancel={() => setEditor(null)}
          />
        ) : (
          <button
            type="button"
            className="sidebar-add"
            aria-label="Add Tag"
            title="Add Tag"
            onClick={() => setEditor({ mode: "create-tag" })}
          >
            <Icon name="plus" size={18} />
            <span className="nav-label">Add Tag</span>
          </button>
        )}
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
            <button
              type="button"
              className="sidebar-add"
              aria-label="Add List"
              title="Add List"
              onClick={() => setEditor({ mode: "create-list" })}
            >
              <Icon name="plus" size={18} />
              <span className="nav-label">Add List</span>
            </button>
            <button
              type="button"
              className="sidebar-add"
              aria-label="Add Folder"
              title="Add Folder"
              onClick={() => setEditor({ mode: "create-folder" })}
            >
              <Icon name="folder-plus" size={18} />
              <span className="nav-label">Add Folder</span>
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
                    collapsed={collapsed}
                    onSelect={onSelect}
                  />
                  <span className="row-actions">
                    <button
                      type="button"
                      aria-label={`Unarchive ${list.name}`}
                      onClick={() => void handleSetArchived(list, false)}
                    >
                      <Icon name="archive-restore" />
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="sidebar-footer">
        <button
          type="button"
          className={settingsSelected ? "sidebar-settings selected" : "sidebar-settings"}
          aria-label="Settings"
          title="Settings"
          onClick={onSelectSettings}
        >
          <Icon name="settings" size={18} />
          <span className="nav-label">Settings</span>
        </button>
        {onLogout !== undefined && (
          <button
            type="button"
            className="sidebar-logout"
            aria-label="Log out"
            title="Log out"
            onClick={onLogout}
          >
            <Icon name="log-out" size={18} />
            <span className="nav-label">Log out</span>
          </button>
        )}
      </div>
    </aside>
  );
}
