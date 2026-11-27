import "./UserMenu.css";
import { useRef, useState } from "react";

import type { CurrentUser } from "../api";
import type { SettingsTab } from "../routes";
import { Icon } from "./Icon";
import { moveMenuFocus } from "./menuFocus";
import { Popover } from "./Popover";

/** The account's initial, the only avatar there is (#468: no uploads). */
export function Avatar({ user }: { user: Pick<CurrentUser, "username"> }): React.JSX.Element {
  return (
    <span className="user-avatar" aria-hidden="true">
      {user.username.charAt(0).toUpperCase()}
    </span>
  );
}

/** Who is signed in: name, an Admin badge for admins, and email. Heads both
 * the desktop menu and the phone's More sheet. */
export function AccountSummary({ user }: { user: CurrentUser }): React.JSX.Element {
  return (
    <div className="user-summary">
      <Avatar user={user} />
      <div className="user-summary-text">
        <span className="user-summary-name">
          {user.username}
          {user.is_admin && <span className="user-admin-badge">Admin</span>}
        </span>
        {user.email !== null && <span className="user-summary-email">{user.email}</span>}
      </div>
    </div>
  );
}

/** The top-right avatar and its menu (#473): one menu for the account,
 * which took over the sidebar footer's (#451) entries. */
export function UserMenu({
  user,
  onSelectTab,
  darkMode,
  onToggleDarkMode,
  onLogout,
}: {
  user: CurrentUser;
  onSelectTab: (tab: SettingsTab) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  /** Absent only when App is rendered without the gate (its tests). */
  onLogout?: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  /** Runs an entry, then closes the menu. */
  const pick = (action: () => void) => (): void => {
    setOpen(false);
    action();
  };

  return (
    <div className="user-menu">
      <button
        ref={trigger}
        type="button"
        className="user-menu-trigger btn-quiet"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Avatar user={user} />
      </button>
      <Popover open={open} triggerRef={trigger} onClose={() => setOpen(false)}>
        <AccountSummary user={user} />
        <ul
          role="menu"
          aria-label="Account menu"
          className="user-menu-list"
          onKeyDown={moveMenuFocus}
        >
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="btn-quiet"
              onClick={pick(() => onSelectTab("account"))}
            >
              <Icon name="settings" size={16} />
              My account
            </button>
          </li>
          {user.is_admin && (
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="btn-quiet"
                onClick={pick(() => onSelectTab("users"))}
              >
                <Icon name="users" size={16} />
                Users
              </button>
            </li>
          )}
          <li role="none">
            {/* A switch: flipping it keeps the menu open on the new theme. */}
            <button
              type="button"
              role="menuitemcheckbox"
              className="btn-quiet"
              aria-checked={darkMode}
              onClick={onToggleDarkMode}
            >
              <Icon name="moon" size={16} />
              Dark mode
              <span className="user-switch" aria-hidden="true" />
            </button>
          </li>
          {onLogout !== undefined && (
            <>
              <li role="separator" className="user-menu-separator" />
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  className="btn-quiet"
                  onClick={pick(onLogout)}
                >
                  <Icon name="log-out" size={16} />
                  Log out
                </button>
              </li>
            </>
          )}
        </ul>
      </Popover>
    </div>
  );
}
