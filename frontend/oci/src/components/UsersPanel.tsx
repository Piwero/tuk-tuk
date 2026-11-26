import "./UsersPanel.css";
import { type ReactNode, useEffect, useRef, useState } from "react";

import {
  type AdminUser,
  type AdminUserChange,
  ApiError,
  type CurrentUser,
  fetchAdminUsers,
  type Page,
  resetAdminUserPassword,
  unlinkAdminUserGoogle,
  updateAdminUser,
} from "../api";
import { formatLastActive } from "../dates";
import { ChangeEmailDialog } from "./ChangeEmailDialog";
import { InvitationsPanel } from "./InvitationsPanel";
import { LoadError, SkeletonRows } from "./TaskViewState";
import { NewUserDialog } from "./NewUserDialog";
import { ResetPasswordDialog } from "./ResetPasswordDialog";
import { LAST_ADMIN_REASON, UserActionsMenu } from "./UserActionsMenu";
import { Avatar } from "./UserMenu";

/** How an account stands (#468): Disabled if it is not active; otherwise
 * Temporary password while a forced step is pending (a temporary password
 * to replace, or the upgraded single user's profile to complete); otherwise
 * Active. */
export type AccountStatus = "Active" | "Temporary password" | "Disabled";

function accountStatus(account: AdminUser): AccountStatus {
  if (!account.is_active) return "Disabled";
  if (account.must_change_password || account.must_complete_profile) {
    return "Temporary password";
  }
  return "Active";
}

const STATUS_STATE: Record<AccountStatus, string> = {
  Active: "active",
  "Temporary password": "pending",
  Disabled: "disabled",
};

/** The server's order (by id), with disabled accounts moved last. */
function disabledLast(accounts: AdminUser[]): AdminUser[] {
  return [
    ...accounts.filter((account) => account.is_active),
    ...accounts.filter((account) => !account.is_active),
  ];
}

/** Whether `account` is the only active Admin listed — the UI's mirror of
 * the server's `last_admin` guard (#412). Disabled Admins don't count. */
function isLastActiveAdmin(account: AdminUser, accounts: AdminUser[]): boolean {
  return (
    account.is_admin &&
    account.is_active &&
    !accounts.some((other) => other.id !== account.id && other.is_admin && other.is_active)
  );
}

/** What a failed row action says: what it couldn't do, then why (the
 * server's `last_admin` guard) or that it may be tried again. */
function failure(account: AdminUser, change: AdminUserChange, error: unknown): string {
  const name = account.username;
  const what =
    change.is_active === false
      ? `disable ${name}`
      : change.is_active === true
        ? `enable ${name}`
        : change.is_admin === true
          ? `make ${name} an admin`
          : `remove admin from ${name}`;
  const why =
    error instanceof ApiError && error.code === "last_admin" ? LAST_ADMIN_REASON : "Try again.";
  return `Couldn’t ${what}. ${why}`;
}

/** One account's row (#477): who it is, its role, its status and when it
 * was last active (#478). The last
 * cell is a slot for the row's actions menu (#479-#481), left out when the
 * table has no actions; `error` says what the row's last action failed to do. */
export function UserRow({
  account,
  isSelf,
  actions,
  error,
}: {
  account: AdminUser;
  isSelf: boolean;
  actions?: ReactNode;
  error?: string;
}): React.JSX.Element {
  const status = accountStatus(account);
  return (
    <tr className="users-row" data-status={STATUS_STATE[status]}>
      <th scope="row" className="users-cell-user">
        <span className="users-who">
          <Avatar user={account} />
          <span className="users-identity">
            <span className="users-name">
              {account.username}
              {isSelf && (
                <>
                  {" "}
                  <span className="users-you">You</span>
                </>
              )}
            </span>{" "}
            {account.email !== null && <span className="users-email">{account.email}</span>}
            {/* How the account signs in (#586), when it isn't just a password. */}
            {account.google_email !== null ? (
              <span className="users-sign-in">Google: {account.google_email}</span>
            ) : (
              !account.has_password && (
                <span className="users-sign-in" data-state="warn">
                  No way to sign in: reset their password
                </span>
              )
            )}
          </span>
        </span>
        {error !== undefined && (
          <p role="alert" className="users-row-error">
            {error}
          </p>
        )}
      </th>
      <td className="users-cell-role">
        {account.is_admin ? <span className="user-admin-badge">Admin</span> : "Member"}
      </td>
      <td className="users-cell-status">
        <span className="users-status" data-status={STATUS_STATE[status]}>
          {status}
        </span>
      </td>
      <td className="users-cell-active">
        {account.last_active_at === null ? (
          formatLastActive(null)
        ) : (
          <time dateTime={account.last_active_at}>
            {formatLastActive(new Date(account.last_active_at))}
          </time>
        )}
      </td>
      {actions !== undefined && <td className="users-cell-actions">{actions}</td>}
    </tr>
  );
}

type ListState =
  { kind: "loading" } | { kind: "failed" } | { kind: "loaded"; page: Page<AdminUser> };

/** Settings › Users (#477): every account on the instance, for Admins.
 * `onAccessLost` runs when the server says the signed-in User is no longer
 * an Admin, so Settings re-reads their record and leaves the tab. */
export function UsersPanel({
  currentUser,
  onAccessLost,
}: {
  currentUser: CurrentUser;
  onAccessLost: () => void;
}): React.JSX.Element {
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState(false);
  /** The account whose password is being reset, and whether it has been. */
  const [resetting, setResetting] = useState<{ account: AdminUser; reset: boolean } | null>(null);
  /** The account whose email is being changed (#586). */
  const [editingEmail, setEditingEmail] = useState<AdminUser | null>(null);
  /** What the last action on a row failed to do, by account id. */
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const onAccessLostRef = useRef(onAccessLost);
  onAccessLostRef.current = onAccessLost;

  /** Re-reads the list behind an open dialog, keeping the table (and the
   * New user button focus returns to) on screen; a failed re-read leaves the
   * list as it was. */
  function rereadQuietly(): void {
    fetchAdminUsers().then(
      (page) => setList({ kind: "loaded", page }),
      () => {},
    );
  }

  useEffect(() => {
    let live = true;
    setList({ kind: "loading" });
    fetchAdminUsers().then(
      (page) => {
        if (live) setList({ kind: "loaded", page });
      },
      (error: unknown) => {
        if (!live) return;
        if (error instanceof ApiError && error.code === "admin_required") {
          onAccessLostRef.current();
          return;
        }
        setList({ kind: "failed" });
      },
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  /** Sends one row's change. On success the list is re-read quietly (no
   * skeleton) so every row, and the last-admin guard, shows what the server
   * now holds; on failure the row stays as it was and says what failed. */
  function clearRowError(id: number): void {
    setRowErrors((errors) => {
      const others = { ...errors };
      delete others[id];
      return others;
    });
  }

  function changeAccount(account: AdminUser, change: AdminUserChange): void {
    clearRowError(account.id);
    updateAdminUser(account.id, change).then(
      (updated) =>
        fetchAdminUsers().then(
          (page) => setList({ kind: "loaded", page }),
          (error: unknown) => {
            if (error instanceof ApiError && error.code === "admin_required") {
              // The Admin removed their own admin rights.
              onAccessLostRef.current();
              return;
            }
            // The change stands even if the re-read failed: show it.
            setList((current) =>
              current.kind === "loaded"
                ? {
                    kind: "loaded",
                    page: {
                      ...current.page,
                      items: current.page.items.map((item) =>
                        item.id === updated.id ? updated : item,
                      ),
                    },
                  }
                : current,
            );
          },
        ),
      (error: unknown) =>
        setRowErrors((errors) => ({ ...errors, [account.id]: failure(account, change, error) })),
    );
  }

  /** Sends one account's new temporary password. On failure the row says so
   * and stays as it was. The list is re-read once the dialog closes, not
   * before: resetting your own password ends this session, and the re-read
   * would leave for sign-in while the password is still on screen. */
  function resetPassword(account: AdminUser, password: string): Promise<void> {
    clearRowError(account.id);
    return resetAdminUserPassword(account.id, password).then(
      () => setResetting({ account, reset: true }),
      (error: unknown) => {
        setRowErrors((errors) => ({
          ...errors,
          [account.id]: `Couldn’t reset ${account.username}’s password. Try again.`,
        }));
        throw error;
      },
    );
  }

  /** Removes an account's Google sign-in (#586); the list is re-read so the
   * row shows how it signs in now. */
  function unlinkGoogle(account: AdminUser): void {
    clearRowError(account.id);
    unlinkAdminUserGoogle(account.id).then(rereadQuietly, () =>
      setRowErrors((errors) => ({
        ...errors,
        [account.id]: `Couldn’t remove Google sign-in from ${account.username}. Try again.`,
      })),
    );
  }

  function closeReset(): void {
    if (resetting?.reset === true) rereadQuietly();
    setResetting(null);
  }

  return (
    <section aria-label="Users" className="users-panel">
      {list.kind === "loading" && <SkeletonRows label="Loading users" count={3} />}
      {list.kind === "failed" && (
        <LoadError what="users" onRetry={() => setAttempt((n) => n + 1)} />
      )}
      {list.kind === "loaded" && (
        <>
          <header className="users-head">
            <div>
              <h2>{list.page.total === 1 ? "1 user" : `${list.page.total} users`}</h2>
              <p className="users-boundary">
                You manage accounts here. You can’t see another user’s tasks, habits or settings.
              </p>
            </div>
            <button
              type="button"
              className="settings-primary-action"
              onClick={() => setCreating(true)}
            >
              New user
            </button>
          </header>
          <table aria-label="Users" className="users-table">
            <thead>
              <tr>
                <th scope="col">User</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Last active</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {disabledLast(list.page.items).map((account) => (
                <UserRow
                  key={account.id}
                  account={account}
                  isSelf={account.id === currentUser.id}
                  error={rowErrors[account.id]}
                  actions={
                    <UserActionsMenu
                      account={account}
                      isSelf={account.id === currentUser.id}
                      isLastAdmin={isLastActiveAdmin(account, list.page.items)}
                      onChange={(change) => changeAccount(account, change)}
                      onResetPassword={() => setResetting({ account, reset: false })}
                      onChangeEmail={() => setEditingEmail(account)}
                      onUnlinkGoogle={() => unlinkGoogle(account)}
                    />
                  }
                />
              ))}
            </tbody>
          </table>
          <InvitationsPanel />
          {editingEmail !== null && (
            <ChangeEmailDialog
              account={editingEmail}
              onSave={(email) =>
                updateAdminUser(editingEmail.id, { email }).then(() => rereadQuietly())
              }
              onClose={() => setEditingEmail(null)}
            />
          )}
          {creating && (
            <NewUserDialog onClose={() => setCreating(false)} onCreated={rereadQuietly} />
          )}
          {resetting !== null && (
            <ResetPasswordDialog
              account={resetting.account}
              isSelf={resetting.account.id === currentUser.id}
              onReset={(password) => resetPassword(resetting.account, password)}
              onClose={closeReset}
            />
          )}
        </>
      )}
    </section>
  );
}
