import "./UsersPanel.css";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { type AdminUser, ApiError, type CurrentUser, fetchAdminUsers, type Page } from "../api";
import { LoadError, SkeletonRows } from "./TaskViewState";
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

/** One account's row (#477): who it is, its role and its status. The last
 * cell is a slot for the row's actions menu (#479-#481), left out when the
 * table has no actions. */
export function UserRow({
  account,
  isSelf,
  actions,
}: {
  account: AdminUser;
  isSelf: boolean;
  actions?: ReactNode;
}): JSX.Element {
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
          </span>
        </span>
      </th>
      <td className="users-cell-role">
        {account.is_admin ? <span className="user-admin-badge">Admin</span> : "Member"}
      </td>
      <td className="users-cell-status">
        <span className="users-status" data-status={STATUS_STATE[status]}>
          {status}
        </span>
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
}): JSX.Element {
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const onAccessLostRef = useRef(onAccessLost);
  onAccessLostRef.current = onAccessLost;

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

  return (
    <section aria-label="Users" className="users-panel">
      {list.kind === "loading" && <SkeletonRows label="Loading users" count={3} />}
      {list.kind === "failed" && (
        <LoadError what="users" onRetry={() => setAttempt((n) => n + 1)} />
      )}
      {list.kind === "loaded" && (
        <>
          <header className="users-head">
            <h2>{list.page.total === 1 ? "1 user" : `${list.page.total} users`}</h2>
            <p className="users-boundary">
              You manage accounts here. You can’t see another user’s tasks, habits or settings.
            </p>
          </header>
          <table aria-label="Users" className="users-table">
            <thead>
              <tr>
                <th scope="col">User</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {disabledLast(list.page.items).map((account) => (
                <UserRow
                  key={account.id}
                  account={account}
                  isSelf={account.id === currentUser.id}
                />
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
