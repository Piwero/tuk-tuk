import "./OverflowMenu.css";
import { useId, useRef, useState } from "react";

import type { AdminUser, AdminUserChange } from "../api";
import { Icon, type IconName } from "./Icon";
import { IconButton } from "./IconButton";
import { moveMenuFocus } from "./menuFocus";
import { Modal } from "./Modal";
import { Popover } from "./Popover";

/** Why the last active Admin's row can't be disabled or demoted — the
 * server's `last_admin` guard (#412), mirrored. */
export const LAST_ADMIN_REASON = "An instance needs at least one active admin.";

/** One account's row menu in Settings › Users (#480, #481): Reset password,
 * Make admin / Remove admin and Disable user / Enable user. There is no
 * delete: accounts are only ever disabled. Disable asks to confirm first;
 * Reset password hands over to the panel's dialog. */
export function UserActionsMenu({
  account,
  isSelf,
  isLastAdmin,
  onChange,
  onResetPassword,
}: {
  account: AdminUser;
  isSelf: boolean;
  /** This is the only active Admin left: Remove admin and Disable user are
   * unavailable, with the reason shown. */
  isLastAdmin: boolean;
  /** Sends a change for this account; the panel reports the outcome. */
  onChange: (change: AdminUserChange) => void;
  /** Opens the reset dialog; focus is back on this menu's button first, so
   * the dialog returns it there. */
  onResetPassword: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const reasonId = useId();
  const label = `Actions for ${account.username}`;

  /** Runs an entry once the menu has closed and focus is back on the
   * trigger, so a dialog it opens returns focus there too. */
  const pick = (action: () => void) => (): void => {
    trigger.current?.focus();
    setOpen(false);
    action();
  };

  /** A menu entry. A `blocked` one stays focusable (so arrow keys reach it
   * and its reason is read) but does nothing. */
  function item(
    text: string,
    icon: IconName,
    action: () => void,
    { danger = false, blocked = false }: { danger?: boolean; blocked?: boolean } = {},
  ): JSX.Element {
    return (
      <li role="none">
        <button
          type="button"
          role="menuitem"
          className={danger ? "overflow-menu-danger btn-quiet" : "btn-quiet"}
          aria-disabled={blocked || undefined}
          aria-describedby={blocked ? reasonId : undefined}
          onClick={blocked ? undefined : pick(action)}
        >
          <Icon name={icon} size={16} />
          {text}
        </button>
      </li>
    );
  }

  return (
    <div className="overflow-menu users-actions">
      <IconButton
        icon="more-vertical"
        size={16}
        className="overflow-menu-trigger"
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        buttonRef={trigger}
        onClick={() => setOpen((current) => !current)}
      />
      <Popover open={open} triggerRef={trigger} onClose={() => setOpen(false)}>
        <ul role="menu" aria-label={label} className="overflow-menu-list" onKeyDown={moveMenuFocus}>
          {item("Reset password", "key-round", onResetPassword)}
          {account.is_admin
            ? item("Remove admin", "shield-off", () => onChange({ is_admin: false }), {
                blocked: isLastAdmin,
              })
            : item("Make admin", "shield", () => onChange({ is_admin: true }))}
          <li role="separator" className="users-actions-separator" />
          {account.is_active
            ? item("Disable user", "ban", () => setConfirmingDisable(true), {
                danger: true,
                blocked: isLastAdmin,
              })
            : item("Enable user", "user-check", () => onChange({ is_active: true }))}
        </ul>
        {isLastAdmin && (
          <p id={reasonId} className="users-actions-reason">
            {LAST_ADMIN_REASON}
          </p>
        )}
      </Popover>
      {confirmingDisable && (
        <Modal title={`Disable ${account.username}?`} onClose={() => setConfirmingDisable(false)}>
          <p className="users-confirm-lead">
            {isSelf
              ? "You are signed out at once and can’t sign in until another admin enables your account. Nothing you own is deleted."
              : `${account.username} is signed out at once and can’t sign in until the account is enabled again. Nothing they own is deleted.`}
          </p>
          <div className="users-confirm-actions">
            <button
              type="button"
              className="btn-secondary"
              autoFocus
              onClick={() => setConfirmingDisable(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary users-confirm-danger"
              onClick={() => {
                setConfirmingDisable(false);
                onChange({ is_active: false });
              }}
            >
              Disable user
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
