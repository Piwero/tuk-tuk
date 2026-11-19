import "./MoreSheet.css";
import { useEffect, useRef } from "react";

import type { CurrentUser, Folder, SmartView, Tag, TaskList } from "../api";
import { byName, byOrder } from "../ordering";
import type { SettingsTab } from "../routes";
import { Icon, type IconName } from "./Icon";
import { AccountSummary } from "./UserMenu";

interface MoreSheetProps {
  lists: TaskList[];
  folders: Folder[];
  tags: Tag[];
  selectedListId: number | null;
  selectedFolderId: number | null;
  selectedTagId: number | null;
  selectedSmart: SmartView | null;
  goalsEnabled: boolean;
  goalsSelected: boolean;
  focusEnabled: boolean;
  focusSelected: boolean;
  standupEnabled: boolean;
  standupSelected: boolean;
  assistantAvailable: boolean;
  assistantSelected: boolean;
  searchSelected: boolean;
  /** The open Settings tab, or null outside Settings. */
  settingsTab: SettingsTab | null;
  /** Who is signed in; the account entries head the sheet once known. */
  user: CurrentUser | null;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onLogout?: () => void;
  onClose: () => void;
  onSelectSmart: (view: SmartView) => void;
  onSelectList: (id: number) => void;
  onSelectFolder: (id: number) => void;
  onSelectTag: (id: number) => void;
  onSelectGoals: () => void;
  onSelectFocus: () => void;
  onSelectStandup: () => void;
  onSelectAssistant: () => void;
  onSelectSearch: () => void;
  onSelectSettingsTab: (tab: SettingsTab) => void;
}

interface RowProps {
  icon?: IconName;
  label: string;
  selected: boolean;
  onClick: () => void;
  swatch?: string | null;
}

/** Plain buttons: like the tab bar (#170) this is touch-first, and buttons
 * keep these names apart from the sidebar's same-named links. */
function Row({ icon, label, selected, onClick, swatch }: RowProps): JSX.Element {
  return (
    <button
      type="button"
      className={selected ? "more-sheet-row selected" : "more-sheet-row"}
      aria-current={selected ? "page" : undefined}
      onClick={onClick}
    >
      {icon !== undefined && <Icon name={icon} size={18} />}
      {swatch !== undefined && swatch !== null && (
        <span className="more-sheet-swatch" style={{ background: swatch }} aria-hidden="true" />
      )}
      <span>{label}</span>
    </button>
  );
}

/** The phone's replacement for the navigation drawer (#462): a bottom sheet
 * opened from the tab bar's More tab, holding the destinations the bar has no
 * room for and the Lists / Folders / Tags tree. Mounted only while open;
 * every choice closes it. */
export function MoreSheet(props: MoreSheetProps): JSX.Element {
  const { lists, folders, tags, onClose } = props;
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  /** Runs a choice, then gets out of the way. */
  const pick = (action: () => void) => (): void => {
    action();
    onClose();
  };

  const inbox = lists.find((list) => list.is_inbox);
  const active = lists.filter((list) => !list.is_inbox && !list.is_archived);
  const archived = lists.filter((list) => !list.is_inbox && list.is_archived).sort(byOrder);
  const loose = active.filter((list) => list.folder_id === null).sort(byOrder);
  const listRow = (list: TaskList): JSX.Element => (
    <li key={list.id}>
      <Row
        label={`${list.emoji ?? ""} ${list.name}`.trim()}
        swatch={list.color}
        selected={props.selectedListId === list.id}
        onClick={pick(() => props.onSelectList(list.id))}
      />
    </li>
  );

  return (
    <>
      <div className="more-sheet-scrim" aria-hidden="true" onClick={onClose} />
      <div className="more-sheet" role="dialog" aria-label="More" tabIndex={-1} ref={panel}>
        <div className="more-sheet-handle" aria-hidden="true" />
        <div className="more-sheet-scroll">
          {props.user !== null && (
            // The user menu's entries (#473): on a phone there is no top bar,
            // so they head this sheet instead.
            <section aria-label="Account" className="more-sheet-account">
              <AccountSummary user={props.user} />
              <Row
                icon="settings"
                label="My account"
                selected={props.settingsTab === "account"}
                onClick={pick(() => props.onSelectSettingsTab("account"))}
              />
              {props.user.is_admin && (
                <Row
                  icon="users"
                  label="Users"
                  selected={props.settingsTab === "users"}
                  onClick={pick(() => props.onSelectSettingsTab("users"))}
                />
              )}
              <button
                type="button"
                role="switch"
                aria-checked={props.darkMode}
                className="more-sheet-row"
                onClick={props.onToggleDarkMode}
              >
                <Icon name="moon" size={18} />
                <span>Dark mode</span>
                <span className="user-switch" aria-hidden="true" />
              </button>
              {props.onLogout !== undefined && (
                <Row
                  icon="log-out"
                  label="Log out"
                  selected={false}
                  onClick={pick(props.onLogout)}
                />
              )}
            </section>
          )}
          <nav aria-label="More destinations">
            {props.goalsEnabled && (
              <Row
                icon="target"
                label="Goals"
                selected={props.goalsSelected}
                onClick={pick(props.onSelectGoals)}
              />
            )}
            {props.focusEnabled && (
              <Row
                icon="timer"
                label="Focus"
                selected={props.focusSelected}
                onClick={pick(props.onSelectFocus)}
              />
            )}
            {props.standupEnabled && (
              <Row
                icon="users"
                label="Stand-up"
                selected={props.standupSelected}
                onClick={pick(props.onSelectStandup)}
              />
            )}
            {props.assistantAvailable && (
              <Row
                icon="sparkles"
                label="Assistant"
                selected={props.assistantSelected}
                onClick={pick(props.onSelectAssistant)}
              />
            )}
            <Row
              icon="search"
              label="Search"
              selected={props.searchSelected}
              onClick={pick(props.onSelectSearch)}
            />
          </nav>
          <nav aria-label="Lists" className="more-sheet-tree">
            <h2>Lists</h2>
            <Row
              icon="calendar-range"
              label="Next 7 Days"
              selected={props.selectedSmart === "next7"}
              onClick={pick(() => props.onSelectSmart("next7"))}
            />
            <Row
              icon="layers"
              label="All"
              selected={props.selectedSmart === "all"}
              onClick={pick(() => props.onSelectSmart("all"))}
            />
            <ul>
              {inbox !== undefined && listRow(inbox)}
              {[...folders].sort(byOrder).map((folder) => (
                <li key={`folder-${folder.id}`}>
                  <Row
                    icon="folder"
                    label={folder.name}
                    selected={props.selectedFolderId === folder.id}
                    onClick={pick(() => props.onSelectFolder(folder.id))}
                  />
                  <ul className="more-sheet-folder-lists">
                    {active
                      .filter((list) => list.folder_id === folder.id)
                      .sort(byOrder)
                      .map(listRow)}
                  </ul>
                </li>
              ))}
              {loose.map(listRow)}
            </ul>
            {archived.length > 0 && (
              <>
                <h2>Archived</h2>
                <ul>{archived.map(listRow)}</ul>
              </>
            )}
          </nav>
          {tags.length > 0 && (
            <nav aria-label="Tags" className="more-sheet-tree">
              <h2>Tags</h2>
              <ul>
                {[...tags].sort(byName).map((tag) => (
                  <li key={tag.id}>
                    <Row
                      label={tag.name}
                      swatch={tag.color}
                      selected={props.selectedTagId === tag.id}
                      onClick={pick(() => props.onSelectTag(tag.id))}
                    />
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      </div>
    </>
  );
}
