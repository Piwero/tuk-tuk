import { useState } from "react";

import {
  createFolder,
  createList,
  createTag,
  deleteFolder,
  deleteList,
  deleteTag,
  fetchTasks,
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
import { currentDragPayload, endDrag, readDragPayload, startDrag } from "../dnd";
import { loadCollapsedFolderIds, saveCollapsedFolderIds } from "../layoutPrefs";
import { appendOrder, byName, byOrder, planInsertBefore } from "../ordering";
import { pathForStaticView } from "../routes";
import { CreateMenu } from "./CreateMenu";
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
  | { mode: "create-list"; folderId: number | null }
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
  /** The selected Folder — set only by clicking its name (the Folder view),
   * never by its disclosure chevron. Independent of selectedListId, since a
   * List inside the Folder can be selected without the Folder itself being
   * "open". */
  selectedFolderId: number | null;
  selectedSmart: SmartView | null;
  calendarSelected: boolean;
  habitsSelected: boolean;
  standupSelected: boolean;
  /** Settings toggle (issue #140): hides the Stand-up nav item entirely
   * when off — the feature's data isn't touched, only its visibility. */
  standupEnabled: boolean;
  focusSelected: boolean;
  settingsSelected: boolean;
  /** Selected when viewing /search — distinct from having typed a query,
   * so the nav item highlights for a blank search too (issue #143). */
  searchSelected: boolean;
  onSelect: (listId: number) => void;
  onSelectFolder: (folderId: number) => void;
  onSelectTag: (tagId: number) => void;
  onSelectSmart: (view: SmartView) => void;
  onSelectCalendar: () => void;
  onSelectHabits: () => void;
  onSelectStandup: () => void;
  onSelectFocus: () => void;
  onSelectSettings: () => void;
  onSearch: (query: string) => void;
  /** The Search nav item (icon-only, always reachable) opens a blank search,
   * as opposed to onSearch which carries a typed query (issue #143). */
  onOpenSearch: () => void;
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
      // Always set, not just when collapsed — expanded names can still be
      // truncated by ellipsis, and the native tooltip is the fallback.
      title={list.name}
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

/** A plain left-click navigates via the app's own history handling; any
 * modified click (cmd/ctrl/shift/middle-button) is left to the browser so
 * opening in a new tab, copying the link, etc. keep working (issue #143). */
function handleNavAnchorClick(
  event: React.MouseEvent<HTMLAnchorElement>,
  onNavigate: () => void,
): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey
  ) {
    return;
  }
  event.preventDefault();
  onNavigate();
}

interface TopNavItemProps {
  icon: IconName;
  label: string;
  /** Present only for the static, URL-addressable views (#143) — the "Tasks"
   * item stays a plain button since Smart Lists aren't URL-addressable. */
  href?: string;
  selected: boolean;
  collapsed: boolean;
  onClick: () => void;
}

/** One item in the top feature row: selected = pill with icon + label, others icon-only. */
function TopNavItem({
  icon,
  label,
  href,
  selected,
  collapsed,
  onClick,
}: TopNavItemProps): JSX.Element {
  const className = selected ? "top-nav-item selected" : "top-nav-item";
  const content = (
    <>
      <Icon name={icon} size={18} />
      {selected && !collapsed && <span>{label}</span>}
    </>
  );
  if (href === undefined) {
    return (
      <button
        type="button"
        className={className}
        aria-label={label}
        title={label}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }
  return (
    <a
      href={href}
      className={className}
      aria-label={label}
      title={label}
      onClick={(event) => handleNavAnchorClick(event, onClick)}
    >
      {content}
    </a>
  );
}

export function Sidebar({
  lists,
  folders,
  tags,
  selectedListId,
  selectedTagId,
  selectedFolderId,
  selectedSmart,
  calendarSelected,
  habitsSelected,
  standupSelected,
  standupEnabled,
  focusSelected,
  settingsSelected,
  searchSelected,
  onSelect,
  onSelectFolder,
  onSelectTag,
  onSelectSmart,
  onSelectCalendar,
  onSelectHabits,
  onSelectStandup,
  onSelectFocus,
  onSelectSettings,
  onSearch,
  onOpenSearch,
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
  // Layout preference, not data — persisted per Folder in localStorage
  // (layoutPrefs), independent of selection. Default expanded.
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<number>>(loadCollapsedFolderIds);
  // The Folder currently under a dragged List — drives both the drop-target
  // highlight and a collapsed Folder's temporary auto-expand, without
  // touching the persisted collapse choice.
  const [dragOverFolderId, setDragOverFolderId] = useState<number | null>(null);

  const inbox = lists.find((list) => list.is_inbox);
  const active = lists.filter((list) => !list.is_inbox && !list.is_archived);
  const archivedLists = lists.filter((list) => !list.is_inbox && list.is_archived).sort(byOrder);
  const archivedListFolder = (list: TaskList): Folder | undefined =>
    list.folder_id === null ? undefined : folders.find((folder) => folder.id === list.folder_id);
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
    // Creation carries no Folder field (out of scope for #126 — no schema
    // change); filing into one is a follow-up patch, exactly like dragging
    // a freshly created List into a Folder would be.
    if (values.folderId === null) {
      onListsChanged((current) => [...current, created]);
    } else {
      const filed = await updateList(created.id, {
        folder_id: values.folderId,
        sort_order: appendOrder(membersOf(values.folderId)),
      });
      onListsChanged((current) => [...current, filed]);
    }
    setEditor(null);
  }

  async function handleEditList(list: TaskList, values: ListFormValues): Promise<void> {
    const folderChanged = values.folderId !== list.folder_id;
    const updated = await updateList(list.id, {
      name: values.name,
      color: values.color,
      emoji: values.emoji === "" ? null : values.emoji,
      ...(folderChanged
        ? {
            folder_id: values.folderId,
            sort_order: appendOrder(
              values.folderId === null ? looseLists : membersOf(values.folderId),
            ),
          }
        : {}),
    });
    applyListUpdate(updated);
    setEditor(null);
  }

  function toggleFolderCollapsed(folderId: number): void {
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      saveCollapsedFolderIds(next);
      return next;
    });
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

  /** Deleting a Folder only ungroups its Lists — nothing is destroyed — so
   * the confirmation says so plainly and stays light next to the List one. */
  async function handleDeleteFolder(folder: Folder): Promise<void> {
    const confirmed = window.confirm(
      `Delete the folder "${folder.name}"? Its lists move to the top level; no tasks are deleted.`,
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

  /** Deleting a List destroys every Task inside it, so the confirmation
   * names the count — worth the extra fetch, since the count isn't held
   * anywhere on the client (lists don't carry a task_count). */
  async function handleDeleteList(list: TaskList): Promise<void> {
    const { total } = await fetchTasks(list.id, 1);
    const consequence =
      total === 0 ? "It has no tasks." : `This destroys ${total} task${total === 1 ? "" : "s"}.`;
    const confirmed = window.confirm(
      `Delete the list "${list.name}"? ${consequence} This cannot be undone.`,
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
    setDragOverFolderId(null);
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

  /** Folders hold Lists, never Tasks — so only a List (or another Folder,
   * for reordering) is a valid drop; a Task dragged over gets no highlight
   * and, by never calling preventDefault, the browser's own not-allowed
   * cursor rather than a silent no-op. */
  function handleFolderDragOver(event: React.DragEvent): void {
    const payload = currentDragPayload();
    if (payload !== null && payload.kind !== "task") {
      event.preventDefault();
    }
  }

  function handleFolderDragEnter(event: React.DragEvent, folder: Folder): void {
    const payload = currentDragPayload();
    if (payload?.kind === "list") {
      event.preventDefault();
      setDragOverFolderId(folder.id);
    }
  }

  /** Ignores a leave into a child element (the row's own children fire
   * their own enter/leave as the pointer crosses them) — only a leave past
   * the row's own boundary clears the highlight. */
  function handleFolderDragLeave(event: React.DragEvent, folder: Folder): void {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) {
      return;
    }
    setDragOverFolderId((current) => (current === folder.id ? null : current));
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
            folders={folders}
            initialFolderId={list.folder_id}
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
          onDragEnd={endDrag}
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
              className="row-action-danger"
              aria-label={`Delete list ${list.name}`}
              onClick={() => void handleDeleteList(list)}
            >
              <Icon name="trash-2" />
            </button>
          </span>
        </div>
      </li>
    );
  }

  const tasksSelected =
    !calendarSelected && !habitsSelected && !standupSelected && !focusSelected && !settingsSelected;

  return (
    <aside className={collapsed ? "sidebar collapsed" : "sidebar"}>
      {/* Scrolls internally, independent of the rest of the app shell
          (issue #159) — everything above the footer lives here so a long
          list tree scrolls without carrying Settings/Log out (below, outside
          this wrapper) along with it. */}
      <div className="sidebar-scroll">
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
            href={pathForStaticView("calendar")}
            selected={calendarSelected}
            collapsed={collapsed}
            onClick={onSelectCalendar}
          />
          <TopNavItem
            icon="repeat"
            label="Habits"
            href={pathForStaticView("habits")}
            selected={habitsSelected}
            collapsed={collapsed}
            onClick={onSelectHabits}
          />
          {standupEnabled && (
            <TopNavItem
              icon="users"
              label="Stand-up"
              href={pathForStaticView("standup")}
              selected={standupSelected}
              collapsed={collapsed}
              onClick={onSelectStandup}
            />
          )}
          <TopNavItem
            icon="timer"
            label="Focus"
            href={pathForStaticView("focus")}
            selected={focusSelected}
            collapsed={collapsed}
            onClick={onSelectFocus}
          />
          <TopNavItem
            icon="search"
            label="Search"
            href={pathForStaticView("search")}
            selected={searchSelected}
            collapsed={collapsed}
            onClick={onOpenSearch}
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
          className="lists-nav"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDropOnNav}
        >
          <div className="lists-nav-heading">
            <h2>Lists</h2>
            <CreateMenu
              onNewList={() => setEditor({ mode: "create-list", folderId: null })}
              onNewFolder={() => setEditor({ mode: "create-folder" })}
            />
          </div>
          {editor?.mode === "create-list" && (
            <ListForm
              folders={folders}
              initialFolderId={editor.folderId}
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
            {[...folders].sort(byOrder).map((folder) => {
              const members = membersOf(folder.id);
              // A drop in progress temporarily overrides a collapsed Folder so
              // the user can see (and reach) the drop, without touching the
              // persisted collapse choice underneath it.
              const isCollapsed =
                collapsedFolderIds.has(folder.id) && dragOverFolderId !== folder.id;
              return (
                <li key={`folder-${folder.id}`} className="folder">
                  {editor?.mode === "rename-folder" && editor.folderId === folder.id ? (
                    <FolderForm
                      initialName={folder.name}
                      onSubmit={(name) => void handleRenameFolder(folder, name)}
                      onCancel={() => setEditor(null)}
                    />
                  ) : (
                    <div
                      className={
                        folder.id === dragOverFolderId ? "folder-row drag-over" : "folder-row"
                      }
                      draggable
                      onDragStart={(event) => startDrag(event, { kind: "folder", id: folder.id })}
                      onDragEnd={endDrag}
                      onDragEnter={(event) => handleFolderDragEnter(event, folder)}
                      onDragOver={handleFolderDragOver}
                      onDragLeave={(event) => handleFolderDragLeave(event, folder)}
                      onDrop={(event) => handleDropOnFolder(event, folder)}
                    >
                      <button
                        type="button"
                        className="folder-disclosure"
                        aria-label={
                          isCollapsed
                            ? `Expand folder ${folder.name}`
                            : `Collapse folder ${folder.name}`
                        }
                        aria-expanded={!isCollapsed}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleFolderCollapsed(folder.id);
                        }}
                      >
                        <Icon name={isCollapsed ? "chevron-right" : "chevron-down"} size={14} />
                      </button>
                      <Icon name="folder" size={16} />
                      <button
                        type="button"
                        className={
                          folder.id === selectedFolderId ? "folder-name selected" : "folder-name"
                        }
                        title={folder.name}
                        onClick={() => onSelectFolder(folder.id)}
                      >
                        {folder.name}
                      </button>
                      <span className="folder-count">{members.length}</span>
                      <span className="row-actions">
                        <button
                          type="button"
                          aria-label={`New list in ${folder.name}`}
                          onClick={() => setEditor({ mode: "create-list", folderId: folder.id })}
                        >
                          <Icon name="plus" />
                        </button>
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
                  {!isCollapsed && (
                    <>
                      <ul className="folder-lists" aria-label={`Lists in ${folder.name}`}>
                        {members.map((list) => renderListItem(list))}
                      </ul>
                      {members.length === 0 && (
                        <p className="folder-empty-hint">
                          No lists here yet — drag one in, or use “New list” above to add one.
                        </p>
                      )}
                    </>
                  )}
                </li>
              );
            })}
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
        {archivedLists.length > 0 && (
          <section className="archived" aria-label="Archived">
            <h2>Archived</h2>
            <ul>
              {archivedLists.map((list) => {
                const originFolder = archivedListFolder(list);
                return (
                  <li key={list.id}>
                    <div className="list-row">
                      <ListButton
                        list={list}
                        selected={list.id === selectedListId}
                        collapsed={collapsed}
                        onSelect={onSelect}
                      />
                      {originFolder !== undefined && (
                        <span
                          className="archived-list-folder"
                          aria-label={`In folder ${originFolder.name}`}
                        >
                          {originFolder.name}
                        </span>
                      )}
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
                );
              })}
            </ul>
          </section>
        )}
      </div>
      <div className="sidebar-footer">
        <a
          href={pathForStaticView("settings")}
          className={settingsSelected ? "sidebar-settings selected" : "sidebar-settings"}
          aria-label="Settings"
          title="Settings"
          onClick={(event) => handleNavAnchorClick(event, onSelectSettings)}
        >
          <Icon name="settings" size={18} />
          <span className="nav-label">Settings</span>
        </a>
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
